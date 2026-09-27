-- Shared totals for Alongside. Counts only: no lead names, phones, or notes.
begin;

alter table public.companion_members
  add column if not exists display_name text not null default '' check (char_length(display_name) <= 24),
  add column if not exists share_alongside boolean not null default true;

create or replace function public.alongside_set_profile(p_name text, p_share boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  if auth.uid() is null then raise exception 'Sign in to continue.' using errcode = '42501'; end if;
  if not exists (select 1 from public.companion_members where user_id = auth.uid() and enabled) then
    raise exception 'Your account needs access from the administrator.' using errcode = '42501';
  end if;
  v_name := left(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 24);
  if v_name ~ '[0-9<>]' then v_name := ''; end if;
  update public.companion_members
    set display_name = v_name, share_alongside = coalesce(p_share, true)
    where user_id = auth.uid();
end $$;
revoke all on function public.alongside_set_profile(text, boolean) from public, anon;
grant execute on function public.alongside_set_profile(text, boolean) to authenticated;

create or replace function public.alongside_board(p_since timestamptz default null)
returns table (
  display_name text,
  is_self boolean,
  calls bigint,
  scheduled bigint,
  refused bigint,
  no_answers bigint,
  held bigint,
  no_shows bigint,
  rescheduled bigint,
  apl numeric,
  referrals bigint
) language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (select 1 from public.companion_members where user_id = auth.uid() and enabled) then
    raise exception 'Your account needs access from the administrator.' using errcode = '42501';
  end if;
  return query
  with people as (
    select m.user_id,
      case
        when m.user_id = auth.uid() then coalesce(nullif(m.display_name, ''), 'You')
        else coalesce(nullif(m.display_name, ''), 'A teammate')
      end as name,
      (m.user_id = auth.uid()) as mine
    from public.companion_members m
    where m.enabled and (m.share_alongside or m.user_id = auth.uid())
  ),
  ev as (
    select e.user_id, e.event_type, count(*)::bigint as n
    from public.companion_events e
    where e.user_id in (select user_id from people)
      and (p_since is null or e.created_at >= p_since)
    group by e.user_id, e.event_type
  ),
  oc as (
    select o.user_id,
      count(*) filter (where o.status = 'held')::bigint as held,
      count(*) filter (where o.status = 'no-show')::bigint as no_shows,
      count(*) filter (where o.status = 'rescheduled')::bigint as rescheduled,
      coalesce(sum(o.apl), 0) as apl,
      coalesce(sum(o.referrals), 0)::bigint as referrals
    from public.appointment_outcomes o
    where o.user_id in (select user_id from people)
      and (p_since is null or o.created_at >= p_since)
    group by o.user_id
  )
  select p.name, p.mine,
    coalesce((select n from ev where ev.user_id = p.user_id and ev.event_type = 'call'), 0),
    coalesce((select n from ev where ev.user_id = p.user_id and ev.event_type = 'virtual-appointment'), 0),
    coalesce((select n from ev where ev.user_id = p.user_id and ev.event_type = 'refused-appointment'), 0),
    coalesce((select n from ev where ev.user_id = p.user_id and ev.event_type = 'no-answer'), 0),
    coalesce(oc.held, 0), coalesce(oc.no_shows, 0), coalesce(oc.rescheduled, 0),
    coalesce(oc.apl, 0), coalesce(oc.referrals, 0)
  from people p
  left join oc on oc.user_id = p.user_id
  order by p.mine desc, p.name;
end $$;
revoke all on function public.alongside_board(timestamptz) from public, anon;
grant execute on function public.alongside_board(timestamptz) to authenticated;

commit;
