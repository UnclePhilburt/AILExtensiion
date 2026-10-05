-- Run after 025. Clears working leads, never sent texts or calendar events.
begin;
alter table public.followup_leads add column if not exists archived_at timestamptz;
alter table public.followup_settings add column if not exists weekly_reset boolean not null default false;
alter table public.followup_settings add column if not exists last_reset_week date;
create or replace function public.plan_clear_for_user(p_user uuid,p_before date default null) returns integer
language plpgsql security definer set search_path='' as $$
declare cleared integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select count(*) into cleared from public.followup_leads where user_id=p_user and archived_at is null and (p_before is null or week_start<p_before);
 -- Preserve stop/reply/appointment records as hidden import protections.
 update public.followup_leads l set status='appointment' where l.user_id=p_user and l.status in ('active','complete') and exists(select 1 from public.scheduled_events e where e.user_id=p_user and e.impact_lead_id=l.lead_id and e.kind<>'callback' and e.starts_at>=now());
 delete from public.followup_actions a using public.followup_leads l where a.user_id=p_user and l.user_id=a.user_id and l.lead_id=a.lead_id and (p_before is null or l.week_start<p_before);
 update public.followup_leads set archived_at=coalesce(archived_at,now()) where user_id=p_user and status in ('replied','appointment','stopped') and (p_before is null or week_start<p_before);
 delete from public.followup_leads where user_id=p_user and status in ('active','complete') and (p_before is null or week_start<p_before);
 update public.followup_settings set imported_count=(select count(*) from public.followup_leads where user_id=p_user and archived_at is null),import_note='Lead list cleared. Import your current IMPACT inbox to start again.' where user_id=p_user;
 return cleared;
end $$;
revoke all on function public.plan_clear_for_user(uuid,date) from public,anon,authenticated;
create or replace function public.plan_clear() returns integer language plpgsql security definer set search_path='' as $$
begin return public.plan_clear_for_user(public.plan_require_user(),null);end $$;
revoke all on function public.plan_clear() from public,anon;
grant execute on function public.plan_clear() to authenticated;
create or replace function public.plan_weekly_reset() returns void language plpgsql security definer set search_path='' as $$
declare n timestamp:=now() at time zone 'America/Chicago';w date;r record;
begin
 w:=n::date-extract(dow from n)::integer;
 if n<w::timestamp+interval '12 hours' then w:=w-7;end if;
 for r in select user_id from public.followup_settings where weekly_reset loop
  perform pg_advisory_xact_lock(hashtextextended(r.user_id::text,0));
  if exists(select 1 from public.followup_settings where user_id=r.user_id and (last_reset_week is null or last_reset_week<w)) then
   perform public.plan_clear_for_user(r.user_id,w);
   update public.followup_settings set last_reset_week=w where user_id=r.user_id;
  end if;
 end loop;
end $$;
revoke all on function public.plan_weekly_reset() from public,anon,authenticated;
-- Enable only Cody's account, and perform the requested one-time full clear.
-- The marker prevents re-running this setup from clearing newly imported leads.
do $$ declare u uuid;n timestamp:=now() at time zone 'America/Chicago';w date;begin
 select id into u from auth.users where lower(email)='cody2931@gmail.com';
 if u is null then raise exception 'Cody account not found; no reset performed.';end if;
 insert into public.followup_settings(user_id,enabled) values(u,true) on conflict(user_id) do nothing;
 if not (select weekly_reset from public.followup_settings where user_id=u) then
  perform public.plan_clear_for_user(u,null);
  w:=n::date-extract(dow from n)::integer;
  if n<w::timestamp+interval '12 hours' then w:=w-7;end if;
  update public.followup_settings set weekly_reset=true,last_reset_week=w where user_id=u;
 end if;
end $$;
-- Hourly check runs at exactly noon Central in CST and CDT; also catches up
-- if the database was unavailable at noon. No other account is enrolled.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('impact-weekly-lead-reset','0 * * * *','select public.plan_weekly_reset()');
commit;
