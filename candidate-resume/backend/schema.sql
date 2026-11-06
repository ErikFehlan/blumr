-- Install only in an empty, candidate-specific Supabase project.
begin;
do $$ begin
  if to_regclass('public.workspaces') is not null or to_regclass('public.candidates') is not null
     or to_regclass('public.profiles') is not null then
    raise exception 'A dedicated candidate identity project is required';
  end if;
end $$;
create schema candidate_private;
revoke all on schema candidate_private from public, anon;
grant usage on schema candidate_private to authenticated;
create table public.resume_versions (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null check (length(title) <= 180),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object' and octet_length(snapshot::text) <= 1700000),
  original_file bytea check (octet_length(original_file) <= 10485760),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);
create index resume_versions_owner on public.resume_versions(owner_id, created_at desc);
create index resume_versions_expiry on public.resume_versions(expires_at);
alter table public.resume_versions enable row level security;
revoke all on public.resume_versions from public, anon, authenticated;
grant select, delete on public.resume_versions to authenticated;
grant insert(id,title,snapshot,original_file) on public.resume_versions to authenticated;
create policy read_own on public.resume_versions for select to authenticated
  using (owner_id = (select auth.uid()) and expires_at > now());
create policy insert_own on public.resume_versions for insert to authenticated
  with check (owner_id = (select auth.uid()) and coalesce((select auth.jwt()->>'is_anonymous'),'false') = 'false');
create policy delete_own on public.resume_versions for delete to authenticated using (owner_id = (select auth.uid()));

-- Serialize per owner so concurrent inserts cannot bypass the saved-version cap.
create function candidate_private.limit_versions() returns trigger language plpgsql
set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.owner_id::text, 157));
  if (select count(*) from public.resume_versions where owner_id = new.owner_id and expires_at > now()) >= 10 then
    raise exception 'Saved version limit reached' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger limit_resume_versions before insert on public.resume_versions for each row
  execute function candidate_private.limit_versions();

create function candidate_private.delete_self() returns void language plpgsql security definer set search_path = '' as $$
declare target uuid := auth.uid();
begin
  if target is null or not exists(select 1 from auth.sessions where user_id=target and id::text=auth.jwt()->>'session_id') then
    raise exception 'A current candidate session is required';
  end if;
  delete from auth.users where id = target;
end $$;
revoke all on function candidate_private.delete_self() from public, anon;
grant execute on function candidate_private.delete_self() to authenticated;
create function public.delete_resume_account() returns void language sql security invoker set search_path = ''
  as 'select candidate_private.delete_self()';
revoke all on function public.delete_resume_account() from public, anon;
grant execute on function public.delete_resume_account() to authenticated;
commit;
