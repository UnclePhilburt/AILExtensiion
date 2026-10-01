-- Run this entire file once in the Supabase SQL editor. Includes migrations 023 and 024.
begin;
alter table public.text_messages drop constraint if exists text_messages_variant_check;
alter table public.text_messages add constraint text_messages_variant_check check(variant in ('A','B','C','D','custom'));
alter table public.text_messages add column if not exists timing_cohort text not null default 'legacy';
alter table public.text_messages add column if not exists offered_slots jsonb not null default '[]'::jsonb;
alter table public.text_messages add column if not exists offer_policy text not null default 'legacy';
create or replace function public.companion_text_experiments_ready() returns boolean language sql stable security invoker set search_path='' as $$ select true $$;
revoke all on function public.companion_text_experiments_ready() from public,anon;
grant execute on function public.companion_text_experiments_ready() to authenticated;
commit;

-- Apply 023 first. All scheduling uses America/Chicago.
begin;
create table public.followup_settings(user_id uuid primary key references auth.users(id), enabled boolean not null default false, imported_at timestamptz, imported_count integer not null default 0, import_note text);
create table public.followup_leads(user_id uuid not null references auth.users(id), lead_id text not null, name text not null, request_type text not null default '', phones jsonb not null default '[]', week_start date not null, status text not null default 'active' check(status in ('active','replied','appointment','stopped','complete')), appointment_at timestamptz, updated_at timestamptz not null default now(), primary key(user_id,lead_id));
create table public.followup_actions(id uuid primary key default gen_random_uuid(),user_id uuid not null,lead_id text not null,step text not null,kind text not null check(kind in ('text','call')),attempt integer not null default 1,due_at timestamptz not null,status text not null default 'pending' check(status in ('pending','claimed','done','skipped','cancelled')),lease_owner uuid,lease_until timestamptz,started_at timestamptz,completed_at timestamptz,result text,draft jsonb,foreign key(user_id,lead_id) references public.followup_leads(user_id,lead_id),unique(user_id,lead_id,step,kind,attempt));
create index followup_due on public.followup_actions(user_id,status,due_at);
alter table public.text_messages add column if not exists campaign_step text;
alter table public.text_messages add column if not exists plan_action_id uuid;
create function public.plan_require_user() returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();begin if u is null or not exists(select 1 from public.companion_members where user_id=u and enabled) then raise exception 'Sign in with an enabled account.';end if;return u;end $$;
revoke all on function public.plan_require_user() from public,anon;
do $$ declare t text;begin foreach t in array array['followup_settings','followup_leads','followup_actions'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy own_plan on public.%I for select to authenticated using(user_id=auth.uid() and exists(select 1 from public.companion_members where user_id=auth.uid() and enabled))',t);
end loop;end $$;
create function public.plan_enable(p_enabled boolean) returns void language plpgsql security definer set search_path='' as $$declare u uuid:=public.plan_require_user();begin perform pg_advisory_xact_lock(hashtextextended(u::text,0)); insert into public.followup_settings(user_id,enabled) values(u,p_enabled) on conflict(user_id) do update set enabled=excluded.enabled;if not p_enabled then update public.followup_actions set status='pending',lease_owner=null,lease_until=null where user_id=u and status='claimed' and started_at is null;end if;end $$;
create function public.plan_import(p_leads jsonb,p_note text default '') returns integer language plpgsql security definer set search_path='' as $$
declare u uuid:=public.plan_require_user();r jsonb;l public.followup_leads;d date:=(now() at time zone 'America/Chicago')::date;w date;day integer;hour integer;attempt integer;total integer:=0;ph jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 if not exists(select 1 from public.followup_settings where user_id=u and enabled) then raise exception 'Enable the follow-up plan first.';end if;
 if jsonb_typeof(p_leads)<>'array' or jsonb_array_length(p_leads)>50 then raise exception 'Invalid import batch.';end if;
 w:=d-extract(dow from d)::integer;
 for r in select value from jsonb_array_elements(p_leads) loop
  if coalesce(r->>'leadId','')!~'^[0-9]{1,20}$' or coalesce(r->>'leadName','')='' then continue;end if;
  select coalesce(jsonb_agg(value),'[]') into ph from jsonb_array_elements(coalesce(r->'phones','[]')) where value->>'label' in ('Mobile','Home') and regexp_replace(value->>'number','[^0-9]','','g') ~ '^[0-9]{10,15}$';
  if ph='[]' then continue;end if;
  insert into public.followup_leads(user_id,lead_id,name,request_type,phones,week_start) values(u,r->>'leadId',left(r->>'leadName',200),left(coalesce(r->>'requestType',''),200),ph,w) on conflict(user_id,lead_id) do nothing returning * into l;
  if not found then update public.followup_leads set name=left(r->>'leadName',200),request_type=left(coalesce(r->>'requestType',''),200),phones=ph,updated_at=now() where user_id=u and lead_id=r->>'leadId';continue;end if;
  total:=total+1;
  for day in 0..6 loop
   if day in (0,2,4,6) then insert into public.followup_actions(user_id,lead_id,step,kind,due_at) values(u,l.lead_id,case day when 0 then 'intro' when 2 then 'tuesday' when 4 then 'thursday' else 'saturday' end,'text',((w+day)::timestamp+make_interval(hours=>case day when 0 then 18 when 6 then 9 else 14 end)) at time zone 'America/Chicago');end if;
   if day>0 then for attempt in 1..(case when day=6 then 2 else 3 end) loop
    hour:=case when day=6 then case attempt when 1 then 10 else 13 end else case attempt when 1 then case when day in (2,4) then 15 else 14 end when 2 then 17 else 20 end end;
    insert into public.followup_actions(user_id,lead_id,step,kind,attempt,due_at) values(u,l.lead_id,'day-'||day,'call',attempt,((w+day)::timestamp+make_interval(hours=>hour)) at time zone 'America/Chicago');
   end loop;end if;
  end loop;
  if exists(select 1 from public.scheduled_events where user_id=u and impact_lead_id=l.lead_id and kind<>'callback' and starts_at>=now()) then update public.followup_leads set status='appointment' where user_id=u and lead_id=l.lead_id;update public.followup_actions set status='cancelled' where user_id=u and lead_id=l.lead_id;end if;
 end loop;
 update public.followup_settings set imported_at=now(), imported_count=imported_count+total,import_note=left(p_note,300) where user_id=u;
 return total;
end $$;
create function public.plan_set_status(p_lead text,p_status text,p_appointment timestamptz default null) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=public.plan_require_user();l public.followup_leads;
begin
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 if p_status not in ('active','replied','appointment','stopped') then raise exception 'Invalid lead status.';end if;
 select * into l from public.followup_leads where user_id=u and lead_id=p_lead for update;if not found then raise exception 'Lead not found.';end if;
 if p_status='appointment' and (p_appointment is null or p_appointment<now()) then raise exception 'Choose a future appointment date and time.';end if;
 update public.followup_leads set status=p_status,appointment_at=case when p_status='appointment' then p_appointment else appointment_at end,updated_at=now() where user_id=u and lead_id=p_lead;
 if p_status='active' then update public.followup_actions set status='pending',lease_owner=null,lease_until=null where user_id=u and lead_id=p_lead and status='cancelled' and due_at>=date_trunc('day',now() at time zone 'America/Chicago') at time zone 'America/Chicago';
 else update public.followup_actions set status='cancelled',lease_owner=null,lease_until=null where user_id=u and lead_id=p_lead and status in ('pending','claimed');end if;
 if p_status in ('replied','appointment') then update public.text_messages set replied=true,appointment=appointment or p_status='appointment',reviewed_at=now() where user_id=u and id=(select id from public.text_messages where user_id=u and lead_id=p_lead order by sent_at desc limit 1);end if;
 if p_status='appointment' then insert into public.scheduled_events(user_id,lead_key,impact_lead_id,lead_name,request_type,kind,starts_at,source,source_line) values(u,p_lead,p_lead,l.name,l.request_type,'virtual-appointment',p_appointment,'phone','Scheduled from follow-up plan') on conflict(user_id,lead_key,kind,starts_at) do nothing;end if;
end $$;
create function public.plan_claim(p_device uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.plan_require_user();a public.followup_actions;l public.followup_leads;n timestamp:=now() at time zone 'America/Chicago';today date:=n::date;dow integer:=extract(dow from n);hr numeric:=extract(hour from n)+extract(minute from n)/60.0;blocked_until timestamptz;
begin
 -- One account lock coordinates claims and status changes across both phones.
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 if not exists(select 1 from public.followup_settings where user_id=u and enabled) then raise exception 'Enable your follow-up plan.';end if;
 update public.followup_actions set status='pending',lease_owner=null,lease_until=null where user_id=u and status='claimed' and lease_until<now() and started_at is null;
 update public.followup_actions expired set status='skipped' where expired.user_id=u and expired.status='pending' and exists(select 1 from public.followup_leads ended where ended.user_id=u and ended.lead_id=expired.lead_id and ended.week_start+7<=today);
 -- Expired calls never stack. Carry only the most recent missed text per lead.
 update public.followup_actions expired set status='skipped' where expired.user_id=u and expired.status='pending' and (expired.due_at at time zone 'America/Chicago')::date<today and (expired.kind='call' or exists(select 1 from public.followup_actions b where b.user_id=u and b.lead_id=expired.lead_id and b.kind='text' and b.due_at>expired.due_at and b.due_at<=now()));
 for a in select x.* from public.followup_actions x join public.followup_leads y using(user_id,lead_id) where x.user_id=u and y.status='active' and ((x.status='claimed' and x.lease_owner=p_device) or (x.status='pending' and x.due_at<=now())) order by (x.lease_owner=p_device) desc nulls last,x.due_at,x.id for update of x loop
  if a.status='claimed' then select * into l from public.followup_leads where user_id=u and lead_id=a.lead_id;return jsonb_build_object('action',to_jsonb(a),'lead',to_jsonb(l));end if;
  if exists(select 1 from public.followup_actions where user_id=u and lead_id=a.lead_id and status='claimed' and (lease_until>now() or started_at is not null)) then continue;end if;
  if dow=0 then if a.kind='call' or hr<18 or hr>=21 then continue;end if;
  elsif dow=6 then if hr<9 or hr>=14 then continue;end if;
  else if hr<14 or hr>=21 then continue;end if;end if;
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
create function public.plan_action(p_id uuid,p_device uuid,p_operation text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
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
   if (extract(dow from now() at time zone 'America/Chicago')=0 and (a.kind='call' or extract(hour from now() at time zone 'America/Chicago') not between 18 and 20)) or (extract(dow from now() at time zone 'America/Chicago')=6 and extract(hour from now() at time zone 'America/Chicago') not between 9 and 13) or (extract(dow from now() at time zone 'America/Chicago') between 1 and 5 and extract(hour from now() at time zone 'America/Chicago') not between 14 and 20) then raise exception 'Outside your working hours. This action will stay saved.';end if;
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
create function public.plan_observe_outcome() returns trigger language plpgsql security definer set search_path='' as $$begin
 perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,0));
 if tg_table_name='text_messages' then
  if new.replied is true then update public.followup_leads set status='replied',updated_at=now() where user_id=new.user_id and lead_id=new.lead_id and status='active';update public.followup_actions set status='cancelled',lease_until=null where user_id=new.user_id and lead_id=new.lead_id and status in ('pending','claimed');end if;
 else if new.kind<>'callback' and new.starts_at>=now() then update public.followup_leads set status='appointment',appointment_at=new.starts_at,updated_at=now() where user_id=new.user_id and lead_id=new.impact_lead_id and status in ('active','replied');update public.followup_actions set status='cancelled',lease_until=null where user_id=new.user_id and lead_id=new.impact_lead_id and status in ('pending','claimed');end if;end if;return new;
end $$;
create trigger plan_text_reply after insert or update of replied on public.text_messages for each row execute function public.plan_observe_outcome();
create trigger plan_appointment after insert or update on public.scheduled_events for each row execute function public.plan_observe_outcome();
revoke all on function public.plan_enable(boolean),public.plan_import(jsonb,text),public.plan_set_status(text,text,timestamptz),public.plan_claim(uuid),public.plan_action(uuid,uuid,text,jsonb),public.plan_observe_outcome() from public,anon;
grant execute on function public.plan_enable(boolean),public.plan_import(jsonb,text),public.plan_set_status(text,text,timestamptz),public.plan_claim(uuid),public.plan_action(uuid,uuid,text,jsonb) to authenticated;
-- Durable command receipts keep a retry from counting the same action twice.
alter table public.followup_actions add column impact_call_queued_at timestamptz, add column impact_result_queued_at timestamptz;
create function public.plan_impact(p_id uuid,p_slot text,p_type text) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=public.plan_require_user();a public.followup_actions;l public.followup_leads;dev uuid;ph jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select * into a from public.followup_actions where user_id=u and id=p_id for update;
 if not found or a.status not in ('claimed','done') or a.started_at is null or p_type not in ('call','no-answer') then raise exception 'No recorded action to sync.';end if;
 if p_type='call' and a.impact_call_queued_at is not null then return;end if;
 if p_type='no-answer' and a.impact_result_queued_at is not null then return;end if;
 if p_type='no-answer' and (a.status<>'done' or a.result<>'no-answer') then raise exception 'Record no answer first.';end if;
 if a.kind='text' and a.status<>'done' then raise exception 'Confirm the text was sent first.';end if;
 select * into l from public.followup_leads where user_id=u and lead_id=a.lead_id;
 select value into ph from jsonb_array_elements(l.phones) order by (value->>'label'='Mobile') desc limit 1;
 select device_id into dev from public.companion_sync where user_id=u;
 perform public.companion_send(case when p_type='call' then a.id else gen_random_uuid() end,dev,jsonb_build_object('type',p_type,'slot',p_slot,'leadId',a.lead_id,'phoneNumber',coalesce(a.draft->>'number',ph->>'number'),'phoneType',case when a.draft is not null then coalesce((select value->>'label' from jsonb_array_elements(l.phones) where value->>'number'=a.draft->>'number' limit 1),'Mobile') else ph->>'label' end));
 if p_type='call' then update public.followup_actions set impact_call_queued_at=now() where id=a.id;
 else update public.followup_actions set impact_result_queued_at=now() where id=a.id;end if;
end $$;
revoke all on function public.plan_impact(uuid,text,text) from public,anon;
grant execute on function public.plan_impact(uuid,text,text) to authenticated;

commit;
