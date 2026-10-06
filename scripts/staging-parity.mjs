// Compare deployment structure only. Never copy production account data into staging.
import {readFile} from 'node:fs/promises';
import {capacityExpectations,workerExpectations,guardExpectations,signupExpectations,knowledgeExpectations,structuralDifferences} from './staging-structure.mjs';
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
  'auth_admin_allowed',has_function_privilege('supabase_auth_admin',p.oid,'execute'),
  'worker_allowed',has_function_privilege('service_role',p.oid,'execute'),
  'anon_denied',not has_function_privilege('anon',p.oid,'execute'),
  'authenticated_allowed',has_function_privilege('authenticated',p.oid,'execute'),
  'clients_denied',not has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute'))
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','blumr_knowledge') and p.prokind='f' and p.proname<>'rls_auto_enable'
 order by kind,name`;
const [production,stage]=await Promise.all(['zqiqjzxcpznhzjengfff','momfzjmycveqginxmqib'].map(ref=>api(ref,'/database/query',{query})));
const expected=capacityExpectations(await readFile('supabase/migrations/20261005121611_assessment_capacity.sql','utf8'));
for(const [key,value] of workerExpectations(await readFile('supabase/migrations/20261005133313_durable_worker_recovery.sql','utf8')))expected.set(key,value);
for(const [key,value] of guardExpectations(await readFile('supabase/migrations/20261005190251_production_readiness_guards.sql','utf8')))expected.set(key,value);
for(const [key,value] of signupExpectations(await readFile('supabase/patches/open-beta-signup.sql','utf8')))expected.set(key,value);
for(const [key,value] of knowledgeExpectations(await readFile('supabase/migrations/20261006174613_automatic_role_knowledge.sql','utf8')))expected.set(key,value);
const differences=structuralDifferences(production,stage,expected);
if(differences.length)throw Error('Staging structural differences: '+differences.join(', '));
const [knowledge]=await api('momfzjmycveqginxmqib','/database/query',{query:`select
 not has_schema_privilege('authenticated','blumr_knowledge','usage') and not has_schema_privilege('anon','blumr_knowledge','usage') as private_schema,
 (select count(*)=4 and bool_and(relrowsecurity and not has_table_privilege('authenticated',c.oid,'select,insert,update,delete') and not has_table_privilege('anon',c.oid,'select,insert,update,delete')) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='blumr_knowledge' and c.relkind='r') as private_tables,
 (select count(*)=4 from pg_trigger where tgname='capture_automatic_knowledge' and tgenabled='O' and tgfoid='blumr_knowledge.capture_source()'::regprocedure) as capture_triggers,
 exists(select from pg_trigger where tgname='a_capture_job_knowledge' and tgrelid='public.jobs'::regclass and tgenabled='O' and tgfoid='blumr_knowledge.capture_job()'::regprocedure) as job_trigger`});
if(!knowledge?.private_schema||!knowledge.private_tables||!knowledge.capture_triggers||!knowledge.job_trigger)throw Error('Automatic knowledge isolation or capture is incomplete');
const [ledger]=await api('momfzjmycveqginxmqib','/database/query',{query:"select relrowsecurity and not has_table_privilege('anon',oid,'select,insert,update,delete') and not has_table_privilege('authenticated',oid,'select,insert,update,delete') and has_table_privilege('service_role',oid,'select,insert,update,delete') as private from pg_class where oid='public.assessment_worker_attempts'::regclass"});
if(ledger?.private!==true)throw Error('Worker attempt ledger is not service-only');
const [uploads]=await api('momfzjmycveqginxmqib','/database/query',{query:`select (select not public and file_size_limit=10485760 and allowed_mime_types=array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain'] from storage.buckets where id='resumes') as private_bucket,
 exists(select 1 from pg_trigger where tgrelid='public.candidate_documents'::regclass and tgname='validate_resume_document' and tgenabled='O' and tgfoid='public.validate_resume_document()'::regprocedure) as document_guard,
 not exists(select 1 from information_schema.columns c where c.table_schema='public' and c.column_name='created_by' and not exists(select 1 from pg_trigger t where t.tgrelid=('public.'||quote_ident(c.table_name))::regclass and t.tgname='preserve_record_creator' and t.tgenabled='O')) as creator_guards`});
if(!uploads?.private_bucket||!uploads.document_guard||!uploads.creator_guards)throw Error('Upload and author guards are incomplete');
const functions=await api('momfzjmycveqginxmqib','/functions');
for(const name of ['analyze-patterns-v2','analyze-patterns-beta','reassess-job','refine-job-criteria','account-controls','onboarding-reminders'])if(!functions.some(f=>f.slug===name&&f.status==='ACTIVE'))throw Error('Staging handler unavailable: '+name);
console.log('PASS: unchanged production structure matches staging; capacity routines match the current migration and private permissions; all required handlers are active.');
