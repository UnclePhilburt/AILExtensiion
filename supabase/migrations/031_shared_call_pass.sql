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
