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
