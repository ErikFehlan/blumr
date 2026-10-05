// Structure and permission fingerprints only; no row content or credentials.
export const backupSecuritySQL=`select coalesce(jsonb_agg(value order by kind,name),'[]'::jsonb) as security from (
 select 'table' kind,c.relname name,jsonb_build_object('kind','table','name',c.relname,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
 'anon_read',has_table_privilege('anon',c.oid,'select'),'client_read',has_table_privilege('authenticated',c.oid,'select'),
 'client_insert',has_table_privilege('authenticated',c.oid,'insert'),'client_update',has_table_privilege('authenticated',c.oid,'update'),'client_delete',has_table_privilege('authenticated',c.oid,'delete')) value
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'
 union all select 'policy',schemaname||'.'||tablename||'.'||policyname,jsonb_build_object('kind','policy','schema',schemaname,'table',tablename,'name',policyname,'cmd',cmd,'roles',roles,'permissive',permissive,'using',qual,'check',with_check) from pg_policies where schemaname in ('public','storage')
 union all select 'function',p.oid::regprocedure::text,jsonb_build_object('kind','function','name',p.oid::regprocedure::text,'source',md5(p.prosrc),'security_definer',p.prosecdef,'config',p.proconfig,'anon',has_function_privilege('anon',p.oid,'execute'),'client',has_function_privilege('authenticated',p.oid,'execute'),'service',has_function_privilege('service_role',p.oid,'execute'))
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and p.proname<>'rls_auto_enable'
) s`;
