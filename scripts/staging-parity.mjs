// Compare deployment structure only. Never copy production account data into staging.
import {readFile} from 'node:fs/promises';
import {capacityExpectations,structuralDifferences} from './staging-structure.mjs';
const token=process.env.SUPABASE_ACCESS_TOKEN;
if(process.env.SUPABASE_PROJECT_REF!=='momfzjmycveqginxmqib'||!token)throw Error('Staging parity requires the isolated staging project');
async function api(ref,path,body){
 const r=await fetch(`https://api.supabase.com/v1/projects/${ref}${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
 if(!r.ok)throw Error(`Parity evidence unavailable (${r.status})`);
 return r.json();
}
const query=`select 'column' as kind, table_name||'.'||column_name as name,
 data_type||':'||is_nullable||':'||coalesce(column_default,'') as definition, null::jsonb as routine
 from information_schema.columns where table_schema='public'
 union all select 'policy',tablename||'.'||policyname,coalesce(qual,'')||':'||coalesce(with_check,'')||':'||roles::text||':'||cmd,null::jsonb from pg_policies where schemaname='public'
 union all select 'function',p.oid::regprocedure::text,pg_get_functiondef(p.oid),jsonb_build_object(
  'source',p.prosrc,'language',(select lanname from pg_language where oid=p.prolang),'result',p.prorettype::regtype::text,
  'setof',p.proretset,'args',pg_get_function_identity_arguments(p.oid),'defaults',pg_get_expr(p.proargdefaults,0),
  'security_definer',p.prosecdef,'volatility',p.provolatile,'config',p.proconfig,
  'worker_allowed',has_function_privilege('service_role',p.oid,'execute'),
  'clients_denied',not has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute'))
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prokind='f' and p.proname<>'rls_auto_enable'
 order by kind,name`;
const [production,stage]=await Promise.all(['zqiqjzxcpznhzjengfff','momfzjmycveqginxmqib'].map(ref=>api(ref,'/database/query',{query})));
const expected=capacityExpectations(await readFile('supabase/migrations/20261005121611_assessment_capacity.sql','utf8'));
const differences=structuralDifferences(production,stage,expected);
if(differences.length)throw Error('Staging structural differences: '+differences.join(', '));
const functions=await api('momfzjmycveqginxmqib','/functions');
for(const name of ['analyze-patterns-v2','analyze-patterns-beta','reassess-job','refine-job-criteria','account-controls','onboarding-reminders'])if(!functions.some(f=>f.slug===name&&f.status==='ACTIVE'))throw Error('Staging handler unavailable: '+name);
console.log('PASS: unchanged production structure matches staging; capacity routines match the current migration and private permissions; all required handlers are active.');
