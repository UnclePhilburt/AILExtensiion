-- After 027. Let unfinished Monday introductory texts continue until 9 PM Central.
begin;
create or replace function public.plan_hours_open(p_kind text,p_step text,p_fallback boolean) returns boolean language plpgsql stable set search_path='' as $$
declare n timestamp:=now() at time zone 'America/Chicago';d int:=extract(dow from n);h int:=extract(hour from n);
begin
 if d=1 and p_fallback then
  return case when p_kind='text' and p_step='intro' then h>=10 and h<21 when p_kind='call' then h>=14 and h<21 else false end;
 end if;
 return case when d=0 then p_kind='text' and h>=18 and h<21 when d=6 then h>=9 and h<14 else h>=14 and h<21 end;
end $$;
revoke all on function public.plan_hours_open(text,text,boolean) from public,anon,authenticated;
commit;
