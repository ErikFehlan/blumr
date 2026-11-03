-- Candidate staging only. Install pg_cron, then verify the job succeeds before admitting users.
begin;
do $$ begin
  if to_regclass('public.workspaces') is not null or to_regclass('public.resume_versions') is null then
    raise exception 'A dedicated candidate project is required';
  end if;
end $$;
create extension if not exists pg_cron;
select cron.schedule('blumr-resume-expire','17 * * * *',
  'delete from public.resume_versions where expires_at <= now()');
commit;
