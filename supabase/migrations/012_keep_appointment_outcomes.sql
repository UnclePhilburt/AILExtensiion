-- Calendar entries expire after 30 days, while appointment production must stay
-- available for month/year/all-time reporting. Keep the outcome if its linked
-- calendar entry is cleaned up.
begin;
alter table public.appointment_outcomes drop constraint appointment_outcomes_scheduled_event_id_fkey;
alter table public.appointment_outcomes alter column scheduled_event_id drop not null;
alter table public.appointment_outcomes add constraint appointment_outcomes_scheduled_event_id_fkey
  foreign key (scheduled_event_id) references public.scheduled_events(id) on delete set null;
commit;
