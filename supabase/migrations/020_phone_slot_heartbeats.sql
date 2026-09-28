-- Keep a separate connection heartbeat for each phone slot, so the extension
-- can identify a disconnected phone without losing its assigned lead.
begin;
alter table public.companion_sync add column if not exists slot_phone_seen jsonb not null default '{}'::jsonb;

create or replace function public.companion_phone_seen(p_slot text default null)
returns void language plpgsql security invoker set search_path = '' as $$
declare slot text := case when p_slot = '2' then '2' else '1' end;
begin
  update public.companion_sync
    set phone_seen = now(),
        slot_phone_seen = coalesce(slot_phone_seen, '{}'::jsonb) || jsonb_build_object(slot, to_jsonb(now()))
    where user_id = auth.uid();
end $$;

revoke all on function public.companion_phone_seen(text) from public, anon;
grant execute on function public.companion_phone_seen(text) to authenticated;
commit;
