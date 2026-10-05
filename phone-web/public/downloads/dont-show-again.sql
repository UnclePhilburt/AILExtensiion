-- Keep Don't show again choices across both phones, imports and weekly resets.
begin;
create table if not exists public.workspace_excluded_leads(user_id uuid not null references auth.users(id),lead_id text not null,created_at timestamptz not null default now(),primary key(user_id,lead_id));
alter table public.workspace_excluded_leads enable row level security;
revoke all on public.workspace_excluded_leads from anon,authenticated;
grant select on public.workspace_excluded_leads to authenticated;
drop policy if exists own_excluded_leads on public.workspace_excluded_leads;
create policy own_excluded_leads on public.workspace_excluded_leads for select to authenticated using(user_id=auth.uid());
create or replace function public.workspace_exclude_lead(p_lead text) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=public.plan_require_user();
begin
 if coalesce(p_lead,'')!~'^[0-9]{1,20}$' then raise exception 'Invalid lead.';end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 insert into public.workspace_excluded_leads(user_id,lead_id) values(u,p_lead) on conflict do nothing;
 update public.followup_leads set status='stopped',updated_at=now() where user_id=u and lead_id=p_lead;
 update public.followup_actions set status='cancelled',lease_owner=null,lease_until=null where user_id=u and lead_id=p_lead and status in ('pending','claimed');
end $$;
create or replace function public.workspace_keep_lead_excluded() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.workspace_excluded_leads where user_id=new.user_id and lead_id=new.lead_id) then
  if tg_table_name='followup_leads' then new.status:='stopped';
  elsif new.status in ('pending','claimed') then new.status:='cancelled';new.lease_owner:=null;new.lease_until:=null;end if;
 end if;return new;
end $$;
drop trigger if exists keep_lead_excluded on public.followup_leads;
create trigger keep_lead_excluded before insert or update on public.followup_leads for each row execute function public.workspace_keep_lead_excluded();
drop trigger if exists keep_action_excluded on public.followup_actions;
create trigger keep_action_excluded before insert or update on public.followup_actions for each row execute function public.workspace_keep_lead_excluded();
revoke all on function public.workspace_exclude_lead(text),public.workspace_keep_lead_excluded() from public,anon;
grant execute on function public.workspace_exclude_lead(text) to authenticated;
create or replace function public.workspace_pass_progress(p_restart integer default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.plan_require_user();p public.workspace_call_passes;called integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select * into p from public.workspace_call_passes where user_id=u for update;
 if not found then return jsonb_build_object('needs_list',true,'called',0,'total',0);end if;
 select coalesce(jsonb_agg(value),'[]'::jsonb) into p.lead_ids from jsonb_array_elements_text(p.lead_ids) v(value) where not exists(select 1 from public.workspace_excluded_leads e where e.user_id=u and e.lead_id=v.value);
 if p_restart=p.pass_number then update public.workspace_call_passes set pass_number=pass_number+1,started_at=now() where user_id=u returning * into p;select coalesce(jsonb_agg(value),'[]'::jsonb) into p.lead_ids from jsonb_array_elements_text(p.lead_ids) v(value) where not exists(select 1 from public.workspace_excluded_leads e where e.user_id=u and e.lead_id=v.value);end if;
 select count(distinct id) into called from(
 select lead_id as id from public.followup_workspace_calls where user_id=u and started_at>=p.started_at
 union all select lead_id from public.followup_actions where user_id=u and kind='call' and started_at>=p.started_at
 ) c where p.lead_ids ? c.id;
 return jsonb_build_object('pass',p.pass_number,'started_at',p.started_at,'called',called,'total',jsonb_array_length(p.lead_ids),'remaining',jsonb_array_length(p.lead_ids)-called);
end $$;
commit;
