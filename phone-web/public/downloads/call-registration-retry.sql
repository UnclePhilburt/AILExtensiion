-- Automatic retries reuse the call ID and do not inflate call statistics.
begin;
create or replace function public.companion_send(p_id uuid, p_device uuid, p_command jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare s public.companion_sync; queued jsonb; action_type text; slot text; slot_lead jsonb; slot_at timestamptz; number_id uuid;
begin
  select * into s from public.companion_sync where user_id = auth.uid() for update;
  if not found or s.device_id <> p_device or s.desktop_seen < now() - interval '45 seconds' then raise exception 'Your computer is offline. Open IMPACT and try again.'; end if;
  action_type := coalesce(p_command->>'type','');
  slot := case when p_command->>'slot' = '2' then '2' else '1' end;
  slot_lead := coalesce(s.slot_leads->slot, case when slot = '1' then s.lead else null end);
  slot_at := nullif(s.slot_seen->>slot,'')::timestamptz;
  if slot = '1' and slot_at is null then slot_at := s.lead_updated_at; end if;
  if action_type not in (
    'next','previous','best-next','call','no-answer','refused-appointment',
    'virtual-appointment','virtual-appointment-day','virtual-appointment-slot',
    'pres-done','reschedule','no-show','send-text','dropped-by','add-comments',
    'in-home','call-back','left-message','dropby-appointment','open-lead'
  ) then raise exception 'Unknown command.'; end if;
  if action_type = 'open-lead' and coalesce(p_command->>'targetLeadId','') !~ '^[0-9]{1,20}$' then raise exception 'That appointment could not be opened.'; end if;
  if slot_lead is null or slot_at is null or slot_at < now() - interval '30 minutes' then
    raise exception '%', case when slot = '2'
      then 'Phone 2 has no IMPACT window yet. Open a second IMPACT window on your computer.'
      else 'Your computer has not sent this lead recently. Open the lead in IMPACT on your computer and try again.' end;
  end if;
  if coalesce(p_command->>'leadId','') = '' or p_command->>'leadId' <> coalesce(slot_lead->>'leadId','') then raise exception 'The lead changed. Wait for the latest lead.'; end if;
  if octet_length(p_command::text) > 4096 then raise exception 'Command too large.'; end if;
  if s.recent_commands @> jsonb_build_array(p_id::text) then return; end if;
  select coalesce(jsonb_agg(value),'[]') into queued from jsonb_array_elements(s.commands) where (value->>'requestedAt')::timestamptz > now() - interval '15 seconds';
  if jsonb_array_length(queued) >= 20 then raise exception 'Too many pending actions. Wait for your computer.'; end if;
  if action_type in ('call','no-answer','refused-appointment','virtual-appointment','next') and not (action_type='call' and exists(select 1 from public.calling_number_calls where user_id=auth.uid() and id::text=p_command->>'healthCallId')) then insert into public.companion_events(user_id,event_type) values (auth.uid(),action_type); end if;
  if action_type in ('no-answer','refused-appointment','virtual-appointment') then insert into public.companion_call_outcomes(user_id,outcome,request_type,local_hour) values (auth.uid(), action_type, left(coalesce(slot_lead->>'requestType',''), 200), extract(hour from timezone('America/Chicago', now()))::smallint); end if;
  if coalesce(p_command->>'healthCallId','') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    number_id := case when coalesce(p_command->>'healthNumberId','') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then (p_command->>'healthNumberId')::uuid else null end;
    perform public.calling_number_record((p_command->>'healthCallId')::uuid, action_type, number_id);
  end if;
  update public.companion_sync set commands = queued || jsonb_build_array(p_command || jsonb_build_object('id',p_id,'requestedAt',now())), recent_commands = (select coalesce(jsonb_agg(value),'[]') from jsonb_array_elements(s.recent_commands) with ordinality where ordinality > greatest(jsonb_array_length(s.recent_commands)-31,0)) || jsonb_build_array(p_id::text), phone_seen = now() where user_id = auth.uid();
end $$;


create or replace function public.companion_retry_call(p_id uuid,p_device uuid,p_command jsonb) returns void language plpgsql security invoker set search_path='' as $$
begin
 if p_command->>'type'<>'call' or coalesce(p_command->>'healthCallId','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'Invalid call retry.';end if;
 if not exists(select 1 from public.followup_workspace_calls where user_id=auth.uid() and id::text=p_command->>'healthCallId' and lead_id=p_command->>'leadId' and result is null and started_at>now()-interval '12 hours') then raise exception 'This call is no longer waiting for registration.';end if;
 perform public.companion_send(p_id,p_device,p_command);
end $$;
revoke all on function public.companion_retry_call(uuid,uuid,jsonb) from public,anon;
grant execute on function public.companion_retry_call(uuid,uuid,jsonb) to authenticated;
commit;
