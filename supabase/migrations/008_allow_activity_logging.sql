-- companion_send records an activity event under the caller's own account.
-- The missing INSERT grant caused the phone to show its generic access error.
begin;
grant insert on public.companion_events to authenticated;
create policy own_companion_event_insert on public.companion_events for insert to authenticated
  with check (user_id = (select auth.uid()));
commit;
