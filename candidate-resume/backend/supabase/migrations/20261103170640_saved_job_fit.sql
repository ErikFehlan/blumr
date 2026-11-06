begin;
do $$ begin
  if to_regclass('public.candidate_saved_jobs') is null or to_regclass('public.workspaces') is not null then
    raise exception 'Dedicated candidate project required';
  end if;
end $$;
alter table public.candidate_saved_jobs
  add column revision uuid not null default gen_random_uuid(),
  add column fit_base_revision uuid,
  add column fit_label text check(fit_label in ('Good fit','Potential fit','Stretch','Needs clarification','More detail needed')),
  add column fit_supported smallint,
  add column fit_total smallint,
  add constraint fit_counts check(
    (fit_base_revision is null and fit_label is null and fit_supported is null and fit_total is null)
    or (fit_base_revision is not null and fit_label is not null and fit_supported is not null and fit_total is not null
        and fit_supported between 0 and fit_total and fit_total between 0 and 100)
  );
grant update(fit_base_revision,fit_label,fit_supported,fit_total) on public.candidate_saved_jobs to authenticated;
create function candidate_private.invalidate_job_fit() returns trigger language plpgsql set search_path='' as $$
begin
  new.revision := gen_random_uuid();
  new.fit_base_revision := null; new.fit_label := null; new.fit_supported := null; new.fit_total := null;
  return new;
end $$;
create trigger invalidate_saved_job_fit before update of title,description on public.candidate_saved_jobs
  for each row when (old.title is distinct from new.title or old.description is distinct from new.description)
  execute function candidate_private.invalidate_job_fit();
commit;
