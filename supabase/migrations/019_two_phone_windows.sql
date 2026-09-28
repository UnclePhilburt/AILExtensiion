-- Two IMPACT windows can stay open. Phone 1 drives window 1. Phone 2 drives window 2.
-- Each phone can also name the calling number its own calls are counted on.
begin;
alter table public.companion_sync
  add column if not exists slot_leads jsonb not null default '{}'::jsonb,
  add column if not exists slot_seen jsonb not null default '{}'::jsonb;

drop function if exists public.companion_desktop(uuid, jsonb);
create function public.companion_desktop(p_device uuid, p_lead jsonb default null, p_slot text default null, p_clear boolean default false)
returns void language plpgsql security invoker set search_path = '' as $$
declare slot text := case when p_slot = '2' then '2' else '1' end;
begin
  insert into public.companion_sync(user_id, device_id, lead, lead_updated_at, slot_leads, slot_seen)
  values (
    auth.uid(), p_device,
    case when p_clear or slot = '2' or p_lead is null then null else p_lead end,
    case when p_lead is not null and slot = '1' and not p_clear then now() end,
    case when p_lead is not null and not p_clear then jsonb_build_object(slot, p_lead) else '{}'::jsonb end,
    case when p_lead is not null and not p_clear then jsonb_build_object(slot, to_jsonb(now())) else '{}'::jsonb end
  )
  on conflict (user_id) do update set
    device_id = p_device,
    desktop_seen = now(),
    slot_leads = case
      when companion_sync.device_id <> p_device then '{}'::jsonb
      when p_clear then companion_sync.slot_leads - slot
      when p_lead is not null then companion_sync.slot_leads || jsonb_build_object(slot, p_lead)
      else companion_sync.slot_leads end,
    slot_seen = case
      when companion_sync.device_id <> p_device then '{}'::jsonb
      when p_clear then companion_sync.slot_seen - slot
      when p_lead is not null then companion_sync.slot_seen || jsonb_build_object(slot, to_jsonb(now()))
      else coalesce((select jsonb_object_agg(e.key, to_jsonb(now())) from jsonb_each(companion_sync.slot_leads) as e), '{}'::jsonb) end,
    lead = case
      when p_clear and slot = '1' then null
      when p_lead is not null and slot = '1' then p_lead
      when companion_sync.device_id <> p_device then null
      else companion_sync.lead end,
    lead_updated_at = case
      when p_clear and slot = '1' then null
      when p_lead is not null and slot = '1' then now()
      when companion_sync.device_id <> p_device then null
      when companion_sync.lead is not null then now()
      else companion_sync.lead_updated_at end,
    commands = case when companion_sync.device_id <> p_device then '[]'::jsonb else companion_sync.commands end
  where companion_sync.device_id = p_device or companion_sync.desktop_seen < now() - interval '45 seconds';
  if not found then raise exception 'Another computer is connected. Close IMPACT there and wait 45 seconds.'; end if;
end $$;

drop function if exists public.companion_take(uuid);
create function public.companion_take(p_device uuid, p_slot text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare s public.companion_sync; queued jsonb; command jsonb; idx int;
begin
  select * into s from public.companion_sync where user_id = auth.uid() and device_id = p_device for update;
  if not found then return null; end if;
  select coalesce(jsonb_agg(value order by ordinality), '[]'::jsonb) into queued
    from jsonb_array_elements(s.commands) with ordinality
    where (value->>'requestedAt')::timestamptz > now() - interval '15 seconds';
  if p_slot is null or p_slot = '' then
    command := queued->0;
    if s.commands <> '[]'::jsonb then
      update public.companion_sync set commands = queued - 0 where user_id = auth.uid();
    end if;
    return command;
  end if;
  select value, ordinality into command, idx
    from jsonb_array_elements(queued) with ordinality
    where coalesce(value->>'slot','1') = case when p_slot = '2' then '2' else '1' end
    order by ordinality limit 1;
  if command is not null then
    update public.companion_sync set commands = (
      select coalesce(jsonb_agg(value order by ordinality), '[]'::jsonb)
      from jsonb_array_elements(queued) with ordinality
      where ordinality <> idx
    ) where user_id = auth.uid();
  elsif s.commands <> queued then
    update public.companion_sync set commands = queued where user_id = auth.uid();
  end if;
  return command;
end $$;

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
  if action_type in ('call','no-answer','refused-appointment','virtual-appointment','next') then insert into public.companion_events(user_id,event_type) values (auth.uid(),action_type); end if;
  if action_type in ('no-answer','refused-appointment','virtual-appointment') then insert into public.companion_call_outcomes(user_id,outcome,request_type,local_hour) values (auth.uid(), action_type, left(coalesce(slot_lead->>'requestType',''), 200), extract(hour from timezone('America/Chicago', now()))::smallint); end if;
  if coalesce(p_command->>'healthCallId','') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    number_id := case when coalesce(p_command->>'healthNumberId','') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then (p_command->>'healthNumberId')::uuid else null end;
    perform public.calling_number_record((p_command->>'healthCallId')::uuid, action_type, number_id);
  end if;
  update public.companion_sync set commands = queued || jsonb_build_array(p_command || jsonb_build_object('id',p_id,'requestedAt',now())), recent_commands = (select coalesce(jsonb_agg(value),'[]') from jsonb_array_elements(s.recent_commands) with ordinality where ordinality > greatest(jsonb_array_length(s.recent_commands)-31,0)) || jsonb_build_array(p_id::text), phone_seen = now() where user_id = auth.uid();
end $$;

drop function if exists public.calling_number_record(uuid, text);
create function public.calling_number_record(p_call uuid, p_type text, p_number uuid default null)
returns void language plpgsql security invoker set search_path = '' as $$
declare chosen uuid;
begin
  if p_call is null then return; end if;
  if p_type='call' then
    select id into chosen from public.calling_numbers where id = p_number and user_id = auth.uid() and not archived;
    if chosen is null then select id into chosen from public.calling_numbers where user_id = auth.uid() and active; end if;
    insert into public.calling_number_calls(id,number_id) values(p_call, chosen)
      on conflict(user_id,id) do nothing;
  elsif p_type in ('no-answer','refused-appointment','virtual-appointment-slot') then
    update public.calling_number_calls set outcome=p_type
      where id=p_call and outcome is null and created_at >= now()-interval '12 hours';
  end if;
end $$;

revoke all on function public.companion_desktop(uuid,jsonb,text,boolean), public.companion_take(uuid,text), public.calling_number_record(uuid,text,uuid) from public, anon;
grant execute on function public.companion_desktop(uuid,jsonb,text,boolean), public.companion_take(uuid,text), public.calling_number_record(uuid,text,uuid) to authenticated;
commit;
