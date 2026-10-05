// Structure and permission fingerprints only; no row content or credentials.
export const backupSecuritySQL=`set search_path=public,pg_catalog;
select coalesce(jsonb_agg(value order by kind,name),'[]'::jsonb) as security from (
 select 'table' kind,c.relname name,jsonb_build_object('kind','table','name',c.relname,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
 'anon_read',has_table_privilege('anon',c.oid,'select'),'client_read',has_table_privilege('authenticated',c.oid,'select'),
 'client_insert',has_table_privilege('authenticated',c.oid,'insert'),'client_update',has_table_privilege('authenticated',c.oid,'update'),'client_delete',has_table_privilege('authenticated',c.oid,'delete')) value
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'
 union all select 'policy',schemaname||'.'||tablename||'.'||policyname,jsonb_build_object('kind','policy','schema',schemaname,'table',tablename,'name',policyname,'cmd',cmd,'roles',roles,'permissive',permissive,'using',qual,'check',with_check) from pg_policies where schemaname in ('public','auth','storage')
 union all select 'function',p.oid::regprocedure::text,jsonb_build_object('kind','function','name',p.oid::regprocedure::text,'source',md5(p.prosrc),'security_definer',p.prosecdef,'config',p.proconfig,'anon',has_function_privilege('anon',p.oid,'execute'),'client',has_function_privilege('authenticated',p.oid,'execute'),'service',has_function_privilege('service_role',p.oid,'execute'))
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and p.proname<>'rls_auto_enable'
 union all select 'trigger',n.nspname||'.'||c.relname||'.'||t.tgname,jsonb_build_object('kind','trigger','schema',n.nspname,'table',c.relname,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid))
 from pg_trigger t join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
 where pn.nspname='public' and n.nspname in ('public','auth','storage') and not t.tgisinternal
) s`;

// The CLI excludes managed schemas. Capture only application customizations,
// with quoted identifiers and their original predicates; no platform replacement.
export const backupManagedSchemaSQL=`set search_path=public,pg_catalog;
select coalesce(string_agg(statement,E'\n' order by kind,name),'') as sql from (
 select 'policy' kind,schemaname||'.'||tablename||'.'||policyname name,
 format('DROP POLICY IF EXISTS %I ON %I.%I; CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s;',
 policyname,schemaname,tablename,policyname,schemaname,tablename,permissive,cmd,
 (select string_agg(case when r='public' then 'PUBLIC' else quote_ident(r) end,', ') from unnest(roles) r),
 case when qual is null then '' else ' USING ('||qual||')' end,
 case when with_check is null then '' else ' WITH CHECK ('||with_check||')' end) statement
 from pg_policies where schemaname in ('auth','storage')
 union all select 'trigger',n.nspname||'.'||c.relname||'.'||t.tgname,
 format('DROP TRIGGER IF EXISTS %I ON %I.%I; %s; ALTER TABLE %I.%I %s TRIGGER %I;',t.tgname,n.nspname,c.relname,pg_get_triggerdef(t.oid),n.nspname,c.relname,
 case t.tgenabled when 'D' then 'DISABLE' when 'A' then 'ENABLE ALWAYS' when 'R' then 'ENABLE REPLICA' else 'ENABLE' end,t.tgname)
 from pg_trigger t join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
 where pn.nspname='public' and n.nspname in ('auth','storage') and not t.tgisinternal
) s`;
