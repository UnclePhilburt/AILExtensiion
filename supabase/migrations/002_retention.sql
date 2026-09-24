-- Supabase-only: remove old customer snapshots from the live database.
-- Supabase backups follow the project's separately configured retention policy.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('companion-retention', '* * * * *', $job$
  update public.companion_sync
  set lead = null, commands = '[]', result = null
  where lead_updated_at < now() - interval '30 minutes'
    and (lead is not null or commands <> '[]'::jsonb or result is not null);
  delete from public.companion_sync where desktop_seen < now() - interval '1 day';
$job$);
