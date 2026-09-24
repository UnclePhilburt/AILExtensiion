-- Stores only Companion action types and timestamps: no customer information.
begin;
create table public.companion_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('call','no-answer','refused-appointment','virtual-appointment','next')),
  created_at timestamptz not null default now()
);
create index companion_events_user_created_idx on public.companion_events(user_id, created_at desc);
alter table public.companion_events enable row level security;
revoke all on public.companion_events from anon, authenticated;
grant select on public.companion_events to authenticated;
create policy own_companion_events on public.companion_events for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.companion_send(p_id uuid, p_device uuid, p_command jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare s public.companion_sync; queued jsonb; action_type text;
begin
  select * into s from public.companion_sync where user_id = auth.uid() for update;
  if not found or s.device_id <> p_device or s.desktop_seen < now() - interval '45 seconds' then raise exception 'Your computer is offline. Open IMPACT and try again.'; end if;
  action_type := coalesce(p_command->>'type','');
  if action_type not in ('next','previous','call','no-answer','refused-appointment','virtual-appointment','virtual-appointment-day','virtual-appointment-slot') then raise exception 'Unknown command.'; end if;
  if s.lead is null or s.lead_updated_at is null or s.lead_updated_at < now() - interval '30 minutes' then raise exception 'Your computer has not sent this lead recently. Open the lead in IMPACT on your computer and try again.'; end if;
  if coalesce(p_command->>'leadId','') = '' or p_command->>'leadId' <> coalesce(s.lead->>'leadId','') then raise exception 'The lead changed. Wait for the latest lead.'; end if;
  if octet_length(p_command::text) > 4096 then raise exception 'Command too large.'; end if;
  if s.recent_commands @> jsonb_build_array(p_id::text) then return; end if;
  select coalesce(jsonb_agg(value),'[]') into queued from jsonb_array_elements(s.commands) where (value->>'requestedAt')::timestamptz > now() - interval '15 seconds';
  if jsonb_array_length(queued) >= 20 then raise exception 'Too many pending actions. Wait for your computer.'; end if;
  if action_type in ('call','no-answer','refused-appointment','virtual-appointment','next') then insert into public.companion_events(user_id,event_type) values (auth.uid(),action_type); end if;
  update public.companion_sync set
    commands = queued || jsonb_build_array(p_command || jsonb_build_object('id',p_id,'requestedAt',now())),
    recent_commands = (select coalesce(jsonb_agg(value),'[]') from jsonb_array_elements(s.recent_commands) with ordinality where ordinality > greatest(jsonb_array_length(s.recent_commands)-31,0)) || jsonb_build_array(p_id::text),
    phone_seen = now()
  where user_id = auth.uid();
end $$;
revoke all on function public.companion_send(uuid,uuid,jsonb) from public, anon;
grant execute on function public.companion_send(uuid,uuid,jsonb) to authenticated;
commit;
