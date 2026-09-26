-- Appointment follow-up entered by the rep from Calendar. One private outcome
-- belongs to one scheduled appointment and feeds the personal statistics pages.
begin;
create table public.appointment_outcomes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  scheduled_event_id bigint not null references public.scheduled_events(id) on delete cascade,
  status text not null default 'held' check (status in ('held','no-show','rescheduled')),
  apl numeric(12,2) not null default 0 check (apl >= 0 and apl <= 10000000),
  referrals integer not null default 0 check (referrals >= 0 and referrals <= 1000),
  notes text not null default '' check (char_length(notes) <= 2000),
  rescheduled_for timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointment_outcomes_once unique (user_id, scheduled_event_id)
);
create index appointment_outcomes_user_created_idx on public.appointment_outcomes(user_id, created_at desc);
alter table public.appointment_outcomes enable row level security;
revoke all on public.appointment_outcomes from anon, authenticated;
grant select, insert, update on public.appointment_outcomes to authenticated;
create policy own_appointment_outcomes on public.appointment_outcomes for all to authenticated
  using (user_id = (select auth.uid()) and exists (select 1 from public.companion_members where user_id = (select auth.uid()) and enabled))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.companion_members where user_id = (select auth.uid()) and enabled));
commit;
