\set ON_ERROR_STOP on
do $$begin
 if not exists(select from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select from pg_roles where rolname='authenticated') then create role authenticated;end if;
 if not exists(select from pg_roles where rolname='service_role') then create role service_role;end if;
 if not exists(select from pg_roles where rolname='supabase_admin') then create role supabase_admin;end if;
end $$;
grant usage,create on schema public to supabase_admin;
alter default privileges for role supabase_admin in schema public grant all on functions to anon,authenticated,service_role;
alter default privileges for role supabase_admin in schema public grant all on tables to anon,authenticated,service_role;
\ir ../scripts/backup-restore-prelude.sql
set role supabase_admin;
create function public.private_worker() returns boolean language sql as $$select true$$;
revoke all on function public.private_worker() from public;
grant execute on function public.private_worker() to service_role;
create table public.client_read_only(id integer);
grant select on public.client_read_only to authenticated;
reset role;
do $$begin
 if has_function_privilege('anon','public.private_worker()','execute') or has_function_privilege('authenticated','public.private_worker()','execute') or not has_function_privilege('service_role','public.private_worker()','execute') then raise exception 'Bootstrap defaults changed restored worker access';end if;
 if has_table_privilege('anon','public.client_read_only','select') or has_table_privilege('authenticated','public.client_read_only','insert,update,delete') or not has_table_privilege('authenticated','public.client_read_only','select') then raise exception 'Bootstrap defaults changed restored table access';end if;
end $$;
select 'PASS: restored source grants survive permissive bootstrap defaults';
