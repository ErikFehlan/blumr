-- Keep optimistic concurrency filters small even for large approved assessments.
begin;
set local lock_timeout = '5s';
alter table public.candidate_assessments
 add column if not exists updated_at timestamptz not null default now();

create or replace function public.version_candidate_assessment()
returns trigger language plpgsql set search_path = '' as $$
begin
 new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
 return new;
end;
$$;
revoke all on function public.version_candidate_assessment() from public, anon, authenticated;
create or replace trigger candidate_assessments_set_updated_at
 before update on public.candidate_assessments
 for each row execute function public.version_candidate_assessment();
notify pgrst, 'reload schema';
commit;
