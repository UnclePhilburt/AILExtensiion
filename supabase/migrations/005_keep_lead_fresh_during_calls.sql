-- Run in the Supabase SQL editor after 001-004.
--
-- While IMPACT sits on "Call - What Happened?" or "Set Appointment", the
-- extension keeps sending its 10-second heartbeat but does not re-send the
-- lead (it is only read from the lead page). Before this change the lead's
-- timestamp stopped moving, so 30 minutes after the call started the phone hid
-- the lead, companion_send rejected results with "The lead changed", and the
-- retention job erased the lead.
--
-- Now a heartbeat from the same computer that still has a lead keeps that lead
-- fresh. Leads are still erased 30 minutes after the computer stops checking in
-- (IMPACT closed or hidden), as before.
begin;
create or replace function public.companion_desktop(p_device uuid, p_lead jsonb default null)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.companion_sync(user_id, device_id, lead, lead_updated_at)
  values (auth.uid(), p_device, p_lead, case when p_lead is not null then now() end)
  on conflict (user_id) do update set
    device_id = p_device, desktop_seen = now(),
    lead = case when p_lead is not null then p_lead when companion_sync.device_id <> p_device then null else companion_sync.lead end,
    lead_updated_at = case
      when p_lead is not null then now()
      when companion_sync.device_id <> p_device then null
      when companion_sync.lead is not null then now()
      else companion_sync.lead_updated_at end,
    commands = case when companion_sync.device_id <> p_device then '[]'::jsonb else companion_sync.commands end
  where companion_sync.device_id = p_device or companion_sync.desktop_seen < now() - interval '45 seconds';
  if not found then raise exception 'Another computer is connected. Close IMPACT there and wait 45 seconds.'; end if;
end $$;

-- Same checks as before; only the stale-lead message is clearer.
create or replace function public.companion_send(p_id uuid, p_device uuid, p_command jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare s public.companion_sync; queued jsonb;
begin
  select * into s from public.companion_sync where user_id = auth.uid() for update;
  if not found or s.device_id <> p_device or s.desktop_seen < now() - interval '45 seconds' then
    raise exception 'Your computer is offline. Open IMPACT and try again.';
  end if;
  if coalesce(p_command->>'type','') not in ('next','previous','call','no-answer','refused-appointment','virtual-appointment','virtual-appointment-day','virtual-appointment-slot') then raise exception 'Unknown command.'; end if;
  if s.lead is null or s.lead_updated_at is null or s.lead_updated_at < now() - interval '30 minutes' then
    raise exception 'Your computer has not sent this lead recently. Open the lead in IMPACT on your computer and try again.';
  end if;
  if coalesce(p_command->>'leadId','') = '' or p_command->>'leadId' <> coalesce(s.lead->>'leadId','') then
    raise exception 'The lead changed. Wait for the latest lead.';
  end if;
  if octet_length(p_command::text) > 4096 then raise exception 'Command too large.'; end if;
  if s.recent_commands @> jsonb_build_array(p_id::text) then return; end if;
  select coalesce(jsonb_agg(value),'[]') into queued from jsonb_array_elements(s.commands)
    where (value->>'requestedAt')::timestamptz > now() - interval '15 seconds';
  if jsonb_array_length(queued) >= 20 then raise exception 'Too many pending actions. Wait for your computer.'; end if;
  update public.companion_sync set
    commands = queued || jsonb_build_array(p_command || jsonb_build_object('id',p_id,'requestedAt',now())),
    recent_commands = (select coalesce(jsonb_agg(value),'[]') from jsonb_array_elements(s.recent_commands) with ordinality where ordinality > greatest(jsonb_array_length(s.recent_commands)-31,0)) || jsonb_build_array(p_id::text),
    phone_seen = now()
  where user_id = auth.uid();
end $$;

revoke all on function public.companion_desktop(uuid,jsonb), public.companion_send(uuid,uuid,jsonb) from public, anon;
grant execute on function public.companion_desktop(uuid,jsonb), public.companion_send(uuid,uuid,jsonb) to authenticated;
commit;
