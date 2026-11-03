-- Additive upgrade for the isolated candidate project. Existing versions stay readable.
begin;
do $$ begin
  if to_regclass('public.resume_versions') is null or to_regclass('public.workspaces') is not null
     or to_regclass('public.candidates') is not null then raise exception 'Dedicated candidate project required'; end if;
end $$;

create table public.candidate_profiles (
  owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 100),
  target_role text not null default '' check (length(target_role) <= 180)
);
create table public.candidate_base_resumes (
  owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  revision uuid not null,
  source_text text not null check (length(trim(source_text)) between 1 and 95000),
  file_name text check(length(file_name) between 1 and 255),
  original_file bytea check (octet_length(original_file) between 1 and 10485760),
  check ((file_name is null) = (original_file is null))
);
create table public.candidate_saved_jobs (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id uuid not null,
  title text not null check (length(title) <= 180),
  employer text not null check(length(employer) <= 180),
  description text not null check(length(trim(description)) between 1 and 22000),
  created_at timestamptz not null default now(),
  primary key (owner_id,id)
);
-- Owner-bound policies and explicit column grants for the three new relations.
do $$ declare rel text; begin
  foreach rel in array array['candidate_profiles','candidate_base_resumes','candidate_saved_jobs'] loop
    execute format('alter table public.%I enable row level security',rel);
    execute format('revoke all on public.%I from public, anon, authenticated',rel);
    execute format('grant select, delete on public.%I to authenticated',rel);
    execute format('create policy candidate_owner on public.%I for all to authenticated using
      (owner_id=(select auth.uid()) and coalesce((select auth.jwt()->>''is_anonymous''),''false'')=''false'')
      with check (owner_id=(select auth.uid()) and coalesce((select auth.jwt()->>''is_anonymous''),''false'')=''false'')',rel);
  end loop;
end $$;
grant insert(display_name,target_role),update(display_name,target_role) on public.candidate_profiles to authenticated;
grant insert(revision,source_text,file_name,original_file),update(revision,source_text,file_name,original_file) on public.candidate_base_resumes to authenticated;
grant insert(id,title,employer,description),update(id,title,employer,description) on public.candidate_saved_jobs to authenticated;

create function candidate_private.limit_saved_jobs() returns trigger language plpgsql set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.owner_id::text,158));
  if not exists(select 1 from public.candidate_saved_jobs where owner_id=new.owner_id and id=new.id)
     and (select count(*) from public.candidate_saved_jobs where owner_id=new.owner_id)>=50 then
    raise exception 'Saved job limit reached' using errcode='P0001';
  end if;
  return new;
end $$;
create trigger limit_candidate_jobs before insert on public.candidate_saved_jobs
  for each row execute function candidate_private.limit_saved_jobs();

-- A version made from the saved base gets its original bytes on the server.
-- Its independent snapshot can still be reopened after deleting or replacing the base.
alter table public.resume_versions add column base_revision uuid;
grant insert(base_revision) on public.resume_versions to authenticated;
create function candidate_private.copy_base_original() returns trigger language plpgsql set search_path='' as $$
declare base public.candidate_base_resumes;
begin
  select * into base from public.candidate_base_resumes
    where owner_id=new.owner_id and owner_id=auth.uid() and revision=new.base_revision;
  if not found or base.source_text is distinct from new.snapshot->>'source' then
    raise exception 'Base resume changed. Reopen it before saving.' using errcode='P0001';
  end if;
  new.original_file := base.original_file;
  new.snapshot := new.snapshot || jsonb_build_object('fileName',base.file_name);
  return new;
end $$;
create trigger copy_candidate_original before insert on public.resume_versions for each row
  when(new.base_revision is not null) execute function candidate_private.copy_base_original();
commit;
