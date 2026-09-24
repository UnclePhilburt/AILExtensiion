-- The Companion is shared with the team: every existing and future Auth user
-- receives a Companion membership automatically. Individual accounts can still
-- be disabled later by setting companion_members.enabled to false.
begin;
create or replace function public.companion_approve_invitation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.companion_members(user_id, enabled) values (new.id, true)
  on conflict (user_id) do update set enabled = true;
  return new;
end $$;

insert into public.companion_members(user_id, enabled)
select id, true from auth.users
on conflict (user_id) do update set enabled = true;
commit;
