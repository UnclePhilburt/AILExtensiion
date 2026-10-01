-- Run once after 024. Enables the text → No answer workflow.
begin;
create or replace function public.plan_impact(p_id uuid,p_slot text,p_type text) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=public.plan_require_user();a public.followup_actions;l public.followup_leads;dev uuid;ph jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select * into a from public.followup_actions where user_id=u and id=p_id for update;
 if not found or a.status not in ('claimed','done') or a.started_at is null or p_type not in ('call','no-answer') then raise exception 'No recorded action to sync.';end if;
 if p_type='call' and a.impact_call_queued_at is not null then return;end if;
 if p_type='no-answer' and a.impact_result_queued_at is not null then return;end if;
 if p_type='no-answer' and (a.status<>'done' or (a.kind='call' and a.result<>'no-answer') or (a.kind='text' and a.result<>'sent')) then raise exception 'Record no answer first.';end if;
 if a.kind='text' and a.draft is null then raise exception 'Prepare the text first.';end if;
 select * into l from public.followup_leads where user_id=u and lead_id=a.lead_id;
 select value into ph from jsonb_array_elements(l.phones) order by (value->>'label'='Mobile') desc limit 1;
 select device_id into dev from public.companion_sync where user_id=u;
 perform public.companion_send(case when p_type='call' then a.id else gen_random_uuid() end,dev,jsonb_build_object('type',p_type,'slot',p_slot,'leadId',a.lead_id,'phoneNumber',coalesce(a.draft->>'number',ph->>'number'),'phoneType',case when a.draft is not null then coalesce((select value->>'label' from jsonb_array_elements(l.phones) where value->>'number'=a.draft->>'number' limit 1),'Mobile') else ph->>'label' end));
 if p_type='call' then update public.followup_actions set impact_call_queued_at=now() where id=a.id;
 else update public.followup_actions set impact_result_queued_at=now() where id=a.id;end if;
end $$;
commit;
