import {pathToFileURL} from 'node:url';
export const query=`select
 (select count(*)=3 and bool_and(relrowsecurity and not has_table_privilege('authenticated',c.oid,'select,insert,update,delete') and not has_table_privilege('anon',c.oid,'select,insert,update,delete')) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('retention_events','retention_cohorts','retention_tracking_state')) as private_tables,
 exists(select 1 from pg_trigger where tgrelid='public.product_usage_events'::regclass and tgname='capture_retention_usage' and tgenabled='O' and tgfoid='public.capture_retention_usage()'::regprocedure) as usage_trigger,
 exists(select 1 from pg_trigger where tgrelid='public.candidate_assessments'::regclass and tgname='capture_retention_submittal' and tgenabled='O' and tgfoid='public.capture_retention_submittal()'::regprocedure) as submittal_trigger,
 not has_function_privilege('anon','public.record_retention_comparison(uuid,uuid[],uuid)','execute') and has_function_privilege('authenticated','public.record_retention_comparison(uuid,uuid[],uuid)','execute') and not has_function_privilege('anon','public.get_admin_retention_summary()','execute') and has_function_privilege('authenticated','public.get_admin_retention_summary()','execute') as api_permissions,
 (select count(*)=1 from public.retention_tracking_state) as tracking_state`;
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 const token=process.env.SUPABASE_ACCESS_TOKEN,ref=process.env.SUPABASE_PROJECT_REF;
 if(!token||!['momfzjmycveqginxmqib','zqiqjzxcpznhzjengfff'].includes(ref))throw Error('Trusted deployment environment required');
 const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('Retention verification unavailable: '+response.status);
 const [row]=await response.json();if(!row||Object.values(row).some(value=>value!==true))throw Error('Retention recording or permissions incomplete');
 console.log('PASS: private retention tables, durable capture triggers, tracking boundary and API grants.');
}
