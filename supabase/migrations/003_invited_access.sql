-- Automatically approve accounts invited by a Supabase administrator.
-- Public/self-service signups do not receive cloud access.
begin;
create function public.companion_approve_invitation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.invited_at is not null then
    insert into public.companion_members(user_id, enabled) values (new.id, true)
    on conflict (user_id) do nothing; -- Never re-enable a revoked membership.
  end if;
  return new;
end $$;
revoke all on function public.companion_approve_invitation() from public, anon, authenticated;
create trigger companion_invited_access
after insert or update of invited_at on auth.users
for each row execute function public.companion_approve_invitation();

-- Include existing invitations, preserving deliberate access revocations.
insert into public.companion_members(user_id, enabled)
select id, true from auth.users where invited_at is not null
on conflict (user_id) do nothing;
commit;
