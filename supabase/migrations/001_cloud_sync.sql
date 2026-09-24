-- Run in the Supabase SQL editor. No service-role key belongs in the app.
begin;
create table public.companion_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true
);
alter table public.companion_members enable row level security;
revoke all on public.companion_members from anon, authenticated;
grant select on public.companion_members to authenticated;
create policy own_membership on public.companion_members for select to authenticated
  using (user_id = (select auth.uid()));

create table public.companion_sync (
  user_id uuid primary key references auth.users(id) on delete cascade,
  device_id uuid not null,
  desktop_seen timestamptz not null default now(),
  phone_seen timestamptz,
  lead jsonb,
  lead_updated_at timestamptz,
  commands jsonb not null default '[]',
  recent_commands jsonb not null default '[]',
  result jsonb,
  constraint bounded_lead check (octet_length(lead::text) <= 262144),
  constraint bounded_queue check (jsonb_array_length(commands) <= 20)
);
alter table public.companion_sync enable row level security;
revoke all on public.companion_sync from anon, authenticated;
grant select, insert, update, delete on public.companion_sync to authenticated;
create policy own_sync on public.companion_sync for all to authenticated
  using (user_id = (select auth.uid()) and exists (
    select 1 from public.companion_members where user_id = (select auth.uid()) and enabled
  ))
  with check (user_id = (select auth.uid()) and exists (
    select 1 from public.companion_members where user_id = (select auth.uid()) and enabled
  ));

create function public.companion_desktop(p_device uuid, p_lead jsonb default null)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.companion_sync(user_id, device_id, lead, lead_updated_at)
  values (auth.uid(), p_device, p_lead, case when p_lead is not null then now() end)
  on conflict (user_id) do update set
    device_id = p_device, desktop_seen = now(),
    lead = case when p_lead is not null then p_lead when companion_sync.device_id <> p_device then null else companion_sync.lead end,
    lead_updated_at = case when p_lead is not null then now() when companion_sync.device_id <> p_device then null else companion_sync.lead_updated_at end,
    commands = case when companion_sync.device_id <> p_device then '[]'::jsonb else companion_sync.commands end
  where companion_sync.device_id = p_device or companion_sync.desktop_seen < now() - interval '45 seconds';
  if not found then raise exception 'Another computer is connected. Close IMPACT there and wait 45 seconds.'; end if;
end $$;

create function public.companion_send(p_id uuid, p_device uuid, p_command jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare s public.companion_sync; queued jsonb;
begin
  select * into s from public.companion_sync where user_id = auth.uid() for update;
  if not found or s.device_id <> p_device or s.desktop_seen < now() - interval '45 seconds' then
    raise exception 'Your computer is offline. Open IMPACT and try again.';
  end if;
  if coalesce(p_command->>'type','') not in ('next','previous','call','no-answer','refused-appointment','virtual-appointment','virtual-appointment-day','virtual-appointment-slot') then raise exception 'Unknown command.'; end if;
  if coalesce(p_command->>'leadId','') = '' or p_command->>'leadId' <> coalesce(s.lead->>'leadId','')
    or s.lead_updated_at < now() - interval '30 minutes' then raise exception 'The lead changed. Wait for the latest lead.'; end if;
  if octet_length(p_command::text) > 4096 then raise exception 'Command too large.'; end if;
  if s.recent_commands @> jsonb_build_array(p_id::text) then return; end if;
  select coalesce(jsonb_agg(value),'[]') into queued from jsonb_array_elements(s.commands)
    where (value->>'requestedAt')::timestamptz > now() - interval '15 seconds';
  if jsonb_array_length(queued) >= 20 then raise exception 'Too many pending actions. Wait for your computer.'; end if;
  update public.companion_sync set
    commands = queued || jsonb_build_array(p_command || jsonb_build_object('id',p_id,'requestedAt',now())),
    recent_commands = (select coalesce(jsonb_agg(value),'[]') from jsonb_array_elements(s.recent_commands) with ordinality where ordinality > greatest(jsonb_array_length(s.recent_commands)-31,0)) || jsonb_build_array(p_id::text),
    phone_seen = now()
  where user_id = auth.uid();
end $$;

create function public.companion_take(p_device uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare s public.companion_sync; queued jsonb; command jsonb;
begin
  select * into s from public.companion_sync where user_id = auth.uid() and device_id = p_device for update;
  if not found then return null; end if;
  select coalesce(jsonb_agg(value),'[]') into queued from jsonb_array_elements(s.commands)
    where (value->>'requestedAt')::timestamptz > now() - interval '15 seconds';
  command := queued->0;
  if s.commands <> '[]'::jsonb then
    update public.companion_sync set commands = queued - 0 where user_id = auth.uid();
  end if;
  return command;
end $$;

revoke all on function public.companion_desktop(uuid,jsonb), public.companion_send(uuid,uuid,jsonb), public.companion_take(uuid) from public, anon;
grant execute on function public.companion_desktop(uuid,jsonb), public.companion_send(uuid,uuid,jsonb), public.companion_take(uuid) to authenticated;

-- The test database has no Realtime publication; production Supabase does.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.companion_sync;
  end if;
end $$;
commit;
