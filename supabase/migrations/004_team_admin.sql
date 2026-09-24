-- Read-only team visibility for the designated Companion administrator.
begin;
create or replace function public.companion_admin_team()
returns table (
  email text,
  enabled boolean,
  desktop_seen timestamptz,
  phone_seen timestamptz
) language plpgsql security definer set search_path = '' as $$
begin
  if lower(coalesce(auth.jwt()->>'email', '')) <> 'cody2931@gmail.com' then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  return query
    select u.email::text, m.enabled, s.desktop_seen, s.phone_seen
    from public.companion_members m
    join auth.users u on u.id = m.user_id
    left join public.companion_sync s on s.user_id = m.user_id
    order by lower(u.email);
end $$;
revoke all on function public.companion_admin_team() from public, anon;
grant execute on function public.companion_admin_team() to authenticated;
commit;
