-- After 028. Shared workspace call history and follow-up results.
begin;
create table if not exists public.followup_workspace_calls(
 user_id uuid not null references auth.users(id),id uuid not null,lead_id text not null,
 lead_name text not null,phone text not null default '',slot text not null,
 started_at timestamptz not null,result text,completed_at timestamptz,action_id uuid,
 primary key(user_id,id),check(result is null or result in ('no-answer','refused-appointment','virtual-appointment-slot')));
alter table public.followup_workspace_calls enable row level security;
revoke all on public.followup_workspace_calls from anon,authenticated;
grant select on public.followup_workspace_calls to authenticated;
drop policy if exists own_workspace_calls on public.followup_workspace_calls;
create policy own_workspace_calls on public.followup_workspace_calls for select to authenticated using(user_id=auth.uid());
create or replace function public.plan_workspace_call(p_call uuid,p_lead jsonb,p_started timestamptz,p_result text default null,p_completed timestamptz default null) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=public.plan_require_user();c public.followup_workspace_calls;a uuid;lid text:=p_lead->>'leadId';
begin
 if p_call is null or coalesce(lid,'')!~'^[0-9]{1,20}$' or p_started is null or p_started>now()+interval '1 minute' or (p_result is not null and p_result not in ('no-answer','refused-appointment','virtual-appointment-slot')) or (p_result is not null and (p_completed is null or p_completed<p_started or p_completed>now()+interval '1 minute')) then raise exception 'Invalid workspace call.';end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 insert into public.followup_workspace_calls(user_id,id,lead_id,lead_name,phone,slot,started_at)
 values(u,p_call,lid,left(coalesce(p_lead->>'leadName',''),200),left(coalesce(p_lead->>'phone',''),40),case when p_lead->>'slot'='2' then '2' else '1' end,p_started) on conflict(user_id,id) do nothing;
 select * into c from public.followup_workspace_calls where user_id=u and id=p_call for update;
 if c.lead_id<>lid then raise exception 'This call belongs to another lead.';end if;
 if p_result is null or c.result is not null then return;end if;
 select id into a from public.followup_actions where user_id=u and lead_id=lid and kind='call' and status in ('pending','claimed') and started_at is null and (due_at at time zone 'America/Chicago')::date=(p_started at time zone 'America/Chicago')::date order by due_at,attempt limit 1 for update;
 update public.followup_workspace_calls set result=p_result,completed_at=p_completed,action_id=a where user_id=u and id=p_call;
 if a is not null then update public.followup_actions set status='done',started_at=c.started_at,completed_at=p_completed,result=case when p_result='no-answer' then 'no-answer' else 'connected' end,lease_owner=null,lease_until=null where id=a;end if;
 if p_result='no-answer' then
  update public.followup_actions set due_at=greatest(due_at,p_completed+interval '2 hours'),status='pending',lease_owner=null,lease_until=null where user_id=u and lead_id=lid and kind='call' and status in ('pending','claimed') and started_at is null and (due_at at time zone 'America/Chicago')::date=(p_completed at time zone 'America/Chicago')::date;
 else
  update public.followup_leads set status=case when p_result='refused-appointment' then 'stopped' else 'appointment' end,updated_at=now() where user_id=u and lead_id=lid and archived_at is null;
  update public.followup_actions set status='cancelled',lease_owner=null,lease_until=null where user_id=u and lead_id=lid and status in ('pending','claimed');
 end if;
end $$;
revoke all on function public.plan_workspace_call(uuid,jsonb,timestamptz,text,timestamptz) from public,anon;
grant execute on function public.plan_workspace_call(uuid,jsonb,timestamptz,text,timestamptz) to authenticated;
commit;

-- After 029. Atomically reserve workspace calls across both phones.
begin;
create index if not exists workspace_calls_lead_time on public.followup_workspace_calls(user_id,lead_id,started_at desc);
create or replace function public.plan_begin_workspace_call(p_call uuid,p_lead jsonb) returns timestamptz language plpgsql security definer set search_path='' as $$
declare u uuid:=public.plan_require_user();lid text:=p_lead->>'leadId';last_call timestamptz;existing public.followup_workspace_calls;
begin
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select * into existing from public.followup_workspace_calls where user_id=u and id=p_call;
 if found then if existing.lead_id<>lid then raise exception 'This call belongs to another lead.';end if;return existing.started_at;end if;
 select max(t) into last_call from (
  select greatest(started_at,completed_at) as t from public.followup_workspace_calls where user_id=u and lead_id=lid
  union all select greatest(started_at,completed_at) from public.followup_actions where user_id=u and lead_id=lid and kind='call' and started_at is not null
 ) recent;
 if last_call>now()-interval '2 hours' then raise exception 'This lead was called recently. Try again after % Central.',to_char((last_call+interval '2 hours') at time zone 'America/Chicago','FMHH12:MI AM');end if;
 perform public.plan_workspace_call(p_call,p_lead,now());
 return now();
end $$;
revoke all on function public.plan_begin_workspace_call(uuid,jsonb) from public,anon;
grant execute on function public.plan_begin_workspace_call(uuid,jsonb) to authenticated;
commit;

-- After 030. One calling pass shared by both phone lanes.
begin;
create table if not exists public.workspace_call_passes(user_id uuid primary key references auth.users(id),pass_number integer not null default 1,started_at timestamptz not null,lead_ids jsonb not null default '[]');
alter table public.workspace_call_passes enable row level security;
revoke all on public.workspace_call_passes from anon,authenticated;
grant select on public.workspace_call_passes to authenticated;
drop policy if exists own_call_pass on public.workspace_call_passes;
create policy own_call_pass on public.workspace_call_passes for select to authenticated using(user_id=auth.uid());
create or replace function public.workspace_pass_list(p_leads jsonb) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=public.plan_require_user();ids jsonb;
begin
 if jsonb_typeof(p_leads)<>'array' or jsonb_array_length(p_leads)>10000 then raise exception 'Invalid calling list.';end if;
 if exists(select 1 from jsonb_array_elements_text(p_leads) v where v!~'^[0-9]{1,20}$') then raise exception 'Invalid lead id.';end if;
 select coalesce(jsonb_agg(id order by id),'[]') into ids from(select distinct value as id from jsonb_array_elements_text(p_leads)) v;
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 insert into public.workspace_call_passes(user_id,started_at,lead_ids) values(u,date_trunc('day',now() at time zone 'America/Chicago') at time zone 'America/Chicago',ids) on conflict(user_id) do update set lead_ids=excluded.lead_ids;
end $$;
create or replace function public.workspace_pass_progress(p_restart integer default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.plan_require_user();p public.workspace_call_passes;called integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select * into p from public.workspace_call_passes where user_id=u for update;
 if not found then return jsonb_build_object('needs_list',true,'called',0,'total',0);end if;
 if p_restart=p.pass_number then update public.workspace_call_passes set pass_number=pass_number+1,started_at=now() where user_id=u returning * into p;end if;
 select count(distinct id) into called from(
 select lead_id as id from public.followup_workspace_calls where user_id=u and started_at>=p.started_at
 union all select lead_id from public.followup_actions where user_id=u and kind='call' and started_at>=p.started_at
 ) c where p.lead_ids ? c.id;
 return jsonb_build_object('pass',p.pass_number,'started_at',p.started_at,'called',called,'total',jsonb_array_length(p.lead_ids),'remaining',jsonb_array_length(p.lead_ids)-called);
end $$;
revoke all on function public.workspace_pass_list(jsonb),public.workspace_pass_progress(integer) from public,anon;
grant execute on function public.workspace_pass_list(jsonb),public.workspace_pass_progress(integer) to authenticated;
commit;
