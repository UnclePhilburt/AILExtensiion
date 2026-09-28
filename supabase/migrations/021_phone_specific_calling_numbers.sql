-- Calls are attributed only to the number selected on the phone that placed them.
-- Older account-wide “active” selections are intentionally ignored.
begin;
create or replace function public.calling_number_record(p_call uuid, p_type text, p_number uuid default null)
returns void language plpgsql security invoker set search_path = '' as $$
declare chosen uuid;
begin
  if p_call is null then return; end if;
  if p_type = 'call' then
    select id into chosen from public.calling_numbers
      where id = p_number and user_id = auth.uid() and not archived;
    insert into public.calling_number_calls(id,number_id) values(p_call, chosen)
      on conflict(user_id,id) do nothing;
  elsif p_type in ('no-answer','refused-appointment','virtual-appointment-slot') then
    update public.calling_number_calls set outcome=p_type
      where id=p_call and outcome is null and created_at >= now()-interval '12 hours';
  end if;
end $$;
revoke all on function public.calling_number_record(uuid,text,uuid) from public, anon;
grant execute on function public.calling_number_record(uuid,text,uuid) to authenticated;
commit;
