-- Account-owned calling numbers and per-call attribution. No customer numbers are stored.
begin;
create table public.calling_numbers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  label text not null default '' check (length(label) <= 40),
  active boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique(user_id, phone), unique(user_id, id), check (not (active and archived))
);
create unique index one_active_calling_number on public.calling_numbers(user_id) where active;
create table public.calling_number_calls (
  id uuid not null,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  number_id uuid,
  created_at timestamptz not null default now(),
  outcome text check (outcome in ('no-answer','refused-appointment','virtual-appointment-slot')),
  primary key(user_id,id),
  foreign key(user_id,number_id) references public.calling_numbers(user_id,id)
);
create index calling_number_calls_history on public.calling_number_calls(user_id,created_at desc);
alter table public.calling_numbers enable row level security;
alter table public.calling_number_calls enable row level security;
revoke all on public.calling_numbers, public.calling_number_calls from anon, authenticated;
grant select, insert, update on public.calling_numbers, public.calling_number_calls to authenticated;
create policy own_calling_numbers on public.calling_numbers to authenticated using(user_id = (select auth.uid())) with check(user_id = (select auth.uid()));
create policy own_calling_number_calls on public.calling_number_calls to authenticated using(user_id = (select auth.uid())) with check(user_id = (select auth.uid()));

create function public.calling_number_save(p_phone text, p_label text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 18));
  insert into public.calling_numbers(phone,label) values(p_phone,trim(p_label))
    on conflict(user_id,phone) do update set label=excluded.label, archived=false;
end $$;
create function public.calling_number_manage(p_id uuid, p_action text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 18));
  if p_action not in ('activate','archive','pause') then raise exception 'Unknown number action.'; end if;
  if not exists(select 1 from public.calling_numbers where id=p_id and not archived) then raise exception 'Calling number not found.'; end if;
  if p_action='activate' then
    update public.calling_numbers set active=false where active;
    update public.calling_numbers set active=true where id=p_id;
  elsif p_action='archive' then
    update public.calling_numbers set active=false,archived=true where id=p_id;
  else
    update public.calling_numbers set active=false where id=p_id;
  end if;
end $$;

create function public.calling_number_record(p_call uuid, p_type text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_call is null then return; end if;
  if p_type='call' then
    -- Store even an unattributed call, so choosing a number later cannot relabel it.
    insert into public.calling_number_calls(id,number_id)
      values(p_call,(select id from public.calling_numbers where active))
      on conflict(user_id,id) do nothing;
  elsif p_type in ('no-answer','refused-appointment','virtual-appointment-slot') then
    update public.calling_number_calls set outcome=p_type
      where id=p_call and outcome is null and created_at >= now()-interval '12 hours';
  end if;
end $$;

create function public.calling_number_stats()
returns table(number_id uuid, period text, calls bigint, recorded bigint, no_answer bigint, appointments bigint, refused bigint)
language sql security invoker set search_path = '' as $$
  select number_id, case when created_at >= now()-interval '30 days' then 'current' else 'previous' end,
    count(*), count(outcome), count(*) filter(where outcome='no-answer'),
    count(*) filter(where outcome='virtual-appointment-slot'), count(*) filter(where outcome='refused-appointment')
  from public.calling_number_calls where created_at >= now()-interval '60 days' and number_id is not null
  group by 1,2
$$;
revoke all on function public.calling_number_save(text,text), public.calling_number_manage(uuid,text), public.calling_number_record(uuid,text), public.calling_number_stats() from public,anon;
grant execute on function public.calling_number_save(text,text), public.calling_number_manage(uuid,text), public.calling_number_record(uuid,text), public.calling_number_stats() to authenticated;
create or replace function public.companion_send(p_id uuid, p_device uuid, p_command jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare s public.companion_sync; queued jsonb; action_type text;
begin
  select * into s from public.companion_sync where user_id = auth.uid() for update;
  if not found or s.device_id <> p_device or s.desktop_seen < now() - interval '45 seconds' then raise exception 'Your computer is offline. Open IMPACT and try again.'; end if;
  action_type := coalesce(p_command->>'type','');
  if action_type not in (
    'next','previous','best-next','call','no-answer','refused-appointment',
    'virtual-appointment','virtual-appointment-day','virtual-appointment-slot',
    'pres-done','reschedule','no-show','send-text','dropped-by','add-comments',
    'in-home','call-back','left-message','dropby-appointment','open-lead'
  ) then raise exception 'Unknown command.'; end if;
  if action_type = 'open-lead' and coalesce(p_command->>'targetLeadId','') !~ '^[0-9]{1,20}$' then raise exception 'That appointment could not be opened.'; end if;
  if s.lead is null or s.lead_updated_at is null or s.lead_updated_at < now() - interval '30 minutes' then raise exception 'Your computer has not sent this lead recently. Open the lead in IMPACT on your computer and try again.'; end if;
  if coalesce(p_command->>'leadId','') = '' or p_command->>'leadId' <> coalesce(s.lead->>'leadId','') then raise exception 'The lead changed. Wait for the latest lead.'; end if;
  if octet_length(p_command::text) > 4096 then raise exception 'Command too large.'; end if;
  if s.recent_commands @> jsonb_build_array(p_id::text) then return; end if;
  select coalesce(jsonb_agg(value),'[]') into queued from jsonb_array_elements(s.commands) where (value->>'requestedAt')::timestamptz > now() - interval '15 seconds';
  if jsonb_array_length(queued) >= 20 then raise exception 'Too many pending actions. Wait for your computer.'; end if;
  if action_type in ('call','no-answer','refused-appointment','virtual-appointment','next') then insert into public.companion_events(user_id,event_type) values (auth.uid(),action_type); end if;
  if action_type in ('no-answer','refused-appointment','virtual-appointment') then insert into public.companion_call_outcomes(user_id,outcome,request_type,local_hour) values (auth.uid(), action_type, left(coalesce(s.lead->>'requestType',''), 200), extract(hour from timezone('America/Chicago', now()))::smallint); end if;
  if coalesce(p_command->>'healthCallId','') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    perform public.calling_number_record((p_command->>'healthCallId')::uuid, action_type);
  end if;
  update public.companion_sync set commands = queued || jsonb_build_array(p_command || jsonb_build_object('id',p_id,'requestedAt',now())), recent_commands = (select coalesce(jsonb_agg(value),'[]') from jsonb_array_elements(s.recent_commands) with ordinality where ordinality > greatest(jsonb_array_length(s.recent_commands)-31,0)) || jsonb_build_array(p_id::text), phone_seen = now() where user_id = auth.uid();
end $$;
commit;
