-- Run in the Supabase SQL editor after 001-008.
--
-- Calendar for the phone app (calendar.html): the appointments and callbacks a
-- rep scheduled. The phone saves them in Cloud mode when a lead arrives whose
-- IMPACT Status history has a current "Schedule ..." line set "by Me", and when
-- the phone itself sets a Virtual Appointment time. Each account sees only its
-- own entries. Unlike companion_sync (a 30-minute snapshot) these rows hold lead
-- names, phone numbers and addresses until 30 days after the scheduled date.
begin;
create table public.scheduled_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_key text not null check (char_length(lead_key) between 1 and 300),
  impact_lead_id text check (char_length(impact_lead_id) <= 100),
  lead_name text not null default '' check (char_length(lead_name) <= 200),
  phone text not null default '' check (char_length(phone) <= 40),
  address text not null default '' check (char_length(address) <= 300),
  request_type text not null default '' check (char_length(request_type) <= 200),
  kind text not null check (kind in ('appointment','virtual-appointment','callback')),
  starts_at timestamptz not null, -- IMPACT (Central) wall clock; Central midnight when all_day
  all_day boolean not null default false, -- "No Time Preference"
  source text not null default 'history' check (source in ('history','phone')),
  source_line text not null default '' check (char_length(source_line) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scheduled_events_once unique (user_id, lead_key, kind, starts_at)
);
create index scheduled_events_user_starts_idx on public.scheduled_events(user_id, starts_at);
alter table public.scheduled_events enable row level security;
revoke all on public.scheduled_events from anon, authenticated;
grant select, insert, update, delete on public.scheduled_events to authenticated;
create policy own_scheduled_events on public.scheduled_events for all to authenticated
  using (user_id = (select auth.uid()) and exists (
    select 1 from public.companion_members where user_id = (select auth.uid()) and enabled
  ))
  with check (user_id = (select auth.uid()) and exists (
    select 1 from public.companion_members where user_id = (select auth.uid()) and enabled
  ));

-- Saves a lead's events (at most 10) for the signed-in user. Re-seeing the same
-- lead updates the rows instead of duplicating them. With p_replace, an upcoming
-- entry read from history that the lead's history no longer lists (a newer
-- Schedule / Reschedule line replaced it) is removed for the kinds sent.
create function public.companion_save_schedule(p_lead jsonb, p_events jsonb, p_replace boolean default false)
returns integer language plpgsql security invoker set search_path = '' as $$
declare v_lead_key text := left(coalesce(p_lead->>'leadKey',''), 300); v_saved integer := 0;
begin
  if v_lead_key = '' then raise exception 'Missing lead.'; end if;
  if jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events) > 10 then raise exception 'Invalid calendar events.'; end if;
  insert into public.scheduled_events as s (user_id, lead_key, impact_lead_id, lead_name, phone, address, request_type, kind, starts_at, all_day, source, source_line)
  select auth.uid(), v_lead_key, nullif(left(coalesce(p_lead->>'leadId',''), 100), ''),
    left(coalesce(p_lead->>'leadName',''), 200), left(coalesce(p_lead->>'phone',''), 40),
    left(coalesce(p_lead->>'address',''), 300), left(coalesce(p_lead->>'requestType',''), 200),
    e->>'kind', (e->>'startsAt')::timestamptz, coalesce((e->>'allDay')::boolean, false),
    case when e->>'source' = 'phone' then 'phone' else 'history' end, left(coalesce(e->>'sourceLine',''), 500)
  from jsonb_array_elements(p_events) e
  on conflict (user_id, lead_key, kind, starts_at) do update set
    impact_lead_id = coalesce(excluded.impact_lead_id, s.impact_lead_id),
    lead_name = excluded.lead_name, phone = excluded.phone, address = excluded.address,
    request_type = excluded.request_type, all_day = excluded.all_day,
    source = case when excluded.source = 'history' then 'history' else s.source end,
    source_line = case when excluded.source = 'history' or s.source = 'phone' then excluded.source_line else s.source_line end,
    updated_at = now();
  get diagnostics v_saved = row_count;
  if p_replace then
    delete from public.scheduled_events s
    where s.user_id = auth.uid() and s.lead_key = v_lead_key and s.source = 'history' and s.starts_at > now()
      and (s.kind = 'callback') in (select e->>'kind' = 'callback' from jsonb_array_elements(p_events) e)
      and not exists (select 1 from jsonb_array_elements(p_events) e
        where e->>'kind' = s.kind and (e->>'startsAt')::timestamptz = s.starts_at);
  end if;
  return v_saved;
end $$;
revoke all on function public.companion_save_schedule(jsonb,jsonb,boolean) from public, anon;
grant execute on function public.companion_save_schedule(jsonb,jsonb,boolean) to authenticated;

-- Remove entries 30 days after their date (Supabase has pg_cron from 002).
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('companion-calendar-retention', '17 * * * *',
      $job$ delete from public.scheduled_events where starts_at < now() - interval '30 days' $job$);
  end if;
end $$;
commit;
