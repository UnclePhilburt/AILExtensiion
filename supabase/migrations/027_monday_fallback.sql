-- After 026. Monday catch-up: intro at 10 AM, normal calls at 2, 5 and 8 PM Central.
begin;
alter table public.followup_leads add column if not exists monday_fallback boolean not null default false;
create or replace function public.plan_prepare_monday(p_user uuid) returns void language plpgsql security definer set search_path='' as $$
declare n timestamp:=now() at time zone 'America/Chicago';r record;
begin
 if extract(dow from n)<>1 then return;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 for r in update public.followup_leads l set monday_fallback=true
  where l.user_id=p_user and l.status='active' and l.archived_at is null and not l.monday_fallback and l.week_start=n::date-1
  and exists(select 1 from public.followup_actions a where a.user_id=p_user and a.lead_id=l.lead_id and a.step='intro' and a.status in ('pending','claimed') and a.started_at is null)
  and not exists(select 1 from public.followup_actions a where a.user_id=p_user and a.lead_id=l.lead_id and a.step='day-1' and a.started_at is not null)
  returning l.lead_id loop
   update public.followup_actions set due_at=(n::date+time '10:00') at time zone 'America/Chicago' where user_id=p_user and lead_id=r.lead_id and step='intro' and started_at is null and status in ('pending','claimed');
 end loop;
end $$;
revoke all on function public.plan_prepare_monday(uuid) from public,anon,authenticated;
create or replace function public.plan_hours_open(p_kind text,p_step text,p_fallback boolean) returns boolean language plpgsql stable set search_path='' as $$
declare n timestamp:=now() at time zone 'America/Chicago';d int:=extract(dow from n);h int:=extract(hour from n);
begin
 if d=1 and p_fallback then
  return case when p_kind='text' and p_step='intro' then h>=10 and h<13 when p_kind='call' then h>=14 and h<21 else false end;
 end if;
 return case when d=0 then p_kind='text' and h>=18 and h<21 when d=6 then h>=9 and h<14 else h>=14 and h<21 end;
end $$;
revoke all on function public.plan_hours_open(text,text,boolean) from public,anon,authenticated;
create or replace function public.plan_claim(p_device uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.plan_require_user();a public.followup_actions;l public.followup_leads;n timestamp:=now() at time zone 'America/Chicago';today date:=n::date;dow integer:=extract(dow from n);hr numeric:=extract(hour from n)+extract(minute from n)/60.0;blocked_until timestamptz;
begin
 -- One account lock coordinates claims and status changes across both phones.
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 perform public.plan_prepare_monday(u);
 if not exists(select 1 from public.followup_settings where user_id=u and enabled) then raise exception 'Enable your follow-up plan.';end if;
 update public.followup_actions set status='pending',lease_owner=null,lease_until=null where user_id=u and status='claimed' and lease_until<now() and started_at is null;
 update public.followup_actions expired set status='skipped' where expired.user_id=u and expired.status='pending' and exists(select 1 from public.followup_leads ended where ended.user_id=u and ended.lead_id=expired.lead_id and ended.week_start+7<=today);
 -- Expired calls never stack. Carry only the most recent missed text per lead.
 update public.followup_actions expired set status='skipped' where expired.user_id=u and expired.status='pending' and (expired.due_at at time zone 'America/Chicago')::date<today and (expired.kind='call' or exists(select 1 from public.followup_actions b where b.user_id=u and b.lead_id=expired.lead_id and b.kind='text' and b.due_at>expired.due_at and b.due_at<=now()));
 for a in select x.* from public.followup_actions x join public.followup_leads y using(user_id,lead_id) where x.user_id=u and y.status='active' and ((x.status='claimed' and x.lease_owner=p_device) or (x.status='pending' and x.due_at<=now())) order by (x.lease_owner=p_device) desc nulls last,x.due_at,x.id for update of x loop
  if a.status='claimed' then if a.started_at is null and not public.plan_hours_open(a.kind,a.step,(select monday_fallback from public.followup_leads where user_id=u and lead_id=a.lead_id)) then continue;end if;select * into l from public.followup_leads where user_id=u and lead_id=a.lead_id;return jsonb_build_object('action',to_jsonb(a),'lead',to_jsonb(l));end if;
  if exists(select 1 from public.followup_actions where user_id=u and lead_id=a.lead_id and status='claimed' and (lease_until>now() or started_at is not null)) then continue;end if;
  if not public.plan_hours_open(a.kind,a.step,(select monday_fallback from public.followup_leads where user_id=u and lead_id=a.lead_id)) then continue;end if;
  if a.kind='text' and exists(select 1 from public.followup_actions where user_id=u and lead_id=a.lead_id and kind='text' and status='done' and (completed_at at time zone 'America/Chicago')::date=today) then continue;end if;
  if a.kind='call' and exists(select 1 from public.followup_actions where user_id=u and lead_id=a.lead_id and kind='call' and (completed_at>now()-interval '2 hours' or started_at>now()-interval '2 hours') and id<>a.id) then continue;end if;
  select max(case when all_day then ((today+1)::timestamp at time zone 'America/Chicago') else starts_at+interval '1 hour' end) into blocked_until from public.scheduled_events where user_id=u and kind<>'callback' and ((all_day and (starts_at at time zone 'America/Chicago')::date=today) or (starts_at<now()+interval '15 minutes' and starts_at+interval '1 hour'>now()));
  if blocked_until is not null then continue;end if;
  select * into l from public.followup_leads where user_id=u and lead_id=a.lead_id for update;
  if l.status<>'active' then continue;end if;
  update public.followup_actions set status='claimed',lease_owner=p_device,lease_until=now()+interval '15 minutes' where id=a.id returning * into a;
  return jsonb_build_object('action',to_jsonb(a),'lead',to_jsonb(l));
 end loop;
 update public.followup_leads finished set status='complete' where finished.user_id=u and finished.status='active' and not exists(select 1 from public.followup_actions remaining where remaining.user_id=u and remaining.lead_id=finished.lead_id and remaining.status in ('pending','claimed'));
 return null;
end $$;
create or replace function public.plan_action(p_id uuid,p_device uuid,p_operation text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.plan_require_user();a public.followup_actions;l public.followup_leads;v text;
begin
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select * into a from public.followup_actions where id=p_id and user_id=u for update;if not found then raise exception 'Action not found.';end if;
 if a.status='done' and p_operation='complete' then return to_jsonb(a);end if;
 select * into l from public.followup_leads where user_id=u and lead_id=a.lead_id for update;
 if l.status<>'active' or a.status<>'claimed' or a.lease_owner is distinct from p_device or (a.lease_until<now() and a.started_at is null) then raise exception 'This action is no longer assigned to this phone. Refresh your queue.';end if;
 if not exists(select 1 from public.followup_settings where user_id=u and enabled) then raise exception 'The plan is paused.';end if;
 if p_operation='renew' then update public.followup_actions set lease_until=now()+interval '15 minutes' where id=a.id;
 elsif p_operation='defer' then update public.followup_actions set status='pending',started_at=null,lease_owner=null,lease_until=null,due_at=greatest(due_at,now()+interval '10 minutes') where id=a.id;
 elsif p_operation='skip' then if a.started_at is not null then raise exception 'Record the result before moving on.';end if;update public.followup_actions set status='pending',due_at=greatest(due_at,now()+interval '10 minutes'),lease_owner=null,lease_until=null where id=a.id;
 elsif p_operation='prepare' then
  if a.kind<>'text' or coalesce(p_payload->>'variant','') not in ('A','B','C','D') or length(coalesce(p_payload->>'body','')) not between 1 and 2000 or regexp_replace(coalesce(p_payload->>'number',''),'[^0-9]','','g')!~'^[0-9]{10,15}$' then raise exception 'Invalid text draft.';end if;
  if a.draft is null or (a.started_at is null and p_payload->>'replace'='true') then update public.followup_actions set draft=p_payload where id=a.id;end if;
 elsif p_operation='start' then
  if a.started_at is null then
   if not public.plan_hours_open(a.kind,a.step,l.monday_fallback) then raise exception 'Outside this step’s scheduled hours. Monday catch-up texts run 10 AM–1 PM; calls run 2–9 PM Central.';end if;
   if exists(select 1 from public.scheduled_events where user_id=u and kind<>'callback' and ((all_day and (starts_at at time zone 'America/Chicago')::date=(now() at time zone 'America/Chicago')::date) or (starts_at<now()+interval '15 minutes' and starts_at+interval '1 hour'>now()))) then raise exception 'Your meeting time is reserved. Continue after your appointment.';end if;
  end if;
  if a.kind='text' and a.draft is null then raise exception 'Prepare the message first.';end if;
  update public.followup_actions set started_at=coalesce(started_at,now()),lease_until=now()+interval '15 minutes' where id=a.id;
 elsif p_operation='complete' then
  if a.started_at is null then raise exception 'Open the text or start the call before recording its result.';end if;
  if a.kind='text' then
   insert into public.text_messages(user_id,id,lead_id,lead_name,phone,body,variant,experiment,request_type,slot,sent_at,local_hour,time_zone,timing_cohort,offered_slots,offer_policy,campaign_step,plan_action_id) values(u,a.id,a.lead_id,l.name,regexp_replace(a.draft->>'number','[^0-9+]','','g'),a.draft->>'body',a.draft->>'variant',a.draft->>'experiment',l.request_type,case when p_payload->>'slot'='2' then '2' else '1' end,now(),extract(hour from now() at time zone 'America/Chicago'),'America/Chicago',coalesce(a.draft->>'timingCohort','standard'),coalesce(a.draft->'offeredSlots','[]'),coalesce(a.draft->>'offerPolicy','standard'),a.step,a.id) on conflict(user_id,id) do nothing;
  elsif coalesce(p_payload->>'result','') not in ('no-answer','connected') then raise exception 'Choose a call result.';end if;
  update public.followup_actions set status='done',completed_at=now(),result=case when a.kind='text' then 'sent' else p_payload->>'result' end,lease_until=null where id=a.id;
  if a.kind='call' and p_payload->>'result'='connected' then perform public.plan_set_status(a.lead_id,'replied');end if;
 else raise exception 'Unknown action.';end if;
 select * into a from public.followup_actions where id=p_id;return to_jsonb(a);
end $$;

commit;
