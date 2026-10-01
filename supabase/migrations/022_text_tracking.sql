begin;
create table public.text_messages (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id uuid not null,
  lead_id text not null check(length(lead_id) between 1 and 100),
  lead_name text not null check(length(lead_name) <= 200),
  phone text not null check(phone ~ '^\+?[0-9]{10,15}$'),
  body text not null check(length(body) between 1 and 2000),
  variant text not null check(variant in ('A','B','custom')),
  experiment text not null check(length(experiment) between 1 and 100),
  request_type text not null default '' check(length(request_type) <= 300),
  slot text not null check(slot in ('1','2')),
  sent_at timestamptz not null,
  local_hour integer not null check(local_hour between 0 and 23),
  time_zone text not null check(length(time_zone) between 1 and 100),
  replied boolean,
  appointment boolean not null default false,
  reviewed_at timestamptz,
  asked_at timestamptz,
  primary key(user_id,id)
);
create index text_messages_sent on public.text_messages(user_id,sent_at desc);
create table public.text_checkin_state (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  last_prompt_at timestamptz not null default '-infinity'
);
alter table public.text_messages enable row level security;
alter table public.text_checkin_state enable row level security;
revoke all on public.text_messages, public.text_checkin_state from anon, authenticated;
grant select, insert on public.text_messages to authenticated;
grant update(replied,appointment,reviewed_at,asked_at) on public.text_messages to authenticated;
grant select, insert, update on public.text_checkin_state to authenticated;
create policy own_texts on public.text_messages to authenticated
using(user_id = (select auth.uid()) and exists(select 1 from public.companion_members m where m.user_id = (select auth.uid()) and m.enabled))
with check(user_id = (select auth.uid()) and exists(select 1 from public.companion_members m where m.user_id = (select auth.uid()) and m.enabled));
create policy own_text_checkins on public.text_checkin_state to authenticated
using(user_id = (select auth.uid()) and exists(select 1 from public.companion_members m where m.user_id = (select auth.uid()) and m.enabled))
with check(user_id = (select auth.uid()) and exists(select 1 from public.companion_members m where m.user_id = (select auth.uid()) and m.enabled));
create function public.companion_text_checkin() returns setof public.text_messages
language plpgsql security invoker set search_path = '' as $$
declare last_at timestamptz; chosen uuid;
begin
  insert into public.text_checkin_state(user_id) values(auth.uid()) on conflict do nothing;
  select last_prompt_at into last_at from public.text_checkin_state where user_id=auth.uid() for update;
  if last_at > now() - interval '24 hours' then return; end if;
  select id into chosen from public.text_messages
    where user_id=auth.uid() and replied is null
      and sent_at between now() - interval '14 days' and now() - interval '24 hours'
      and (asked_at is null or asked_at < now() - interval '48 hours')
    order by random() limit 1;
  if chosen is null then return; end if;
  update public.text_checkin_state set last_prompt_at=now() where user_id=auth.uid();
  update public.text_messages set asked_at=now() where user_id=auth.uid() and id=chosen;
  return query select * from public.text_messages where user_id=auth.uid() and id=chosen;
end $$;
revoke all on function public.companion_text_checkin() from public, anon;
grant execute on function public.companion_text_checkin() to authenticated;
commit;
