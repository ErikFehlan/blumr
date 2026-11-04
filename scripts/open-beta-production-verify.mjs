import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {closedConfiguration,productionProject} from './billing-production-closed.mjs';
import {releasedFunctions,validateHistory} from './billing-production-deploy.mjs';
import {assertBillingHealth} from './billing-health.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
export const betaConfiguration=Object.freeze({...closedConfiguration,AI_PROVIDER_CALLS_DISABLED:'false'});
export const betaStateSQL=`select
 public.subscription_billing_risk_command('health','{}'::jsonb) as health,
 (select ai_paused from public.security_limits limit 1) as ai_paused,
 (select count(*)=2 and bool_and(active) from cron.job where jobname in ('ancalagon-criteria-worker','ancalagon-job-reassessment')) as ai_workers_active,
 (select count(*)=1 and bool_and(not active) from cron.job where jobname='blumr-billing-reconcile') as billing_worker_paused,
 (select count(*)=1 and bool_and(active) from cron.job where jobname='blumr-direct-ai-cleanup') as cleanup_active,
 (select count(*) from public.subscription_accounts) as subscription_accounts,
 (select count(*)=13 and bool_and(c.relrowsecurity and not has_table_privilege('anon',c.oid,'select') and not has_table_privilege('authenticated',c.oid,'insert,update,delete')) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and ((n.nspname='public' and c.relname like 'subscription_%') or n.nspname='blumr_billing_private')) as ledger_isolation,
 (select encode(sha256(convert_to(decrypted_secret,'UTF8')),'hex') from vault.decrypted_secrets where name='billing_production_reconcile_secret') as billing_worker_digest,
 (select encode(sha256(convert_to(decrypted_secret,'UTF8')),'hex') from vault.decrypted_secrets where name='job_reassessment_secret') as assessment_worker_digest`;
export function assertBetaState(state){
 assertBillingHealth(state?.health);
 if(Object.values(state.health).some(n=>n!==0)||state.ai_paused!==false||state.ai_workers_active!==true||
  state.billing_worker_paused!==true||state.cleanup_active!==true||state.ledger_isolation!==true||state.subscription_accounts!==0||
  !/^[a-f0-9]{64}$/.test(state.billing_worker_digest||'')||!/^[a-f0-9]{64}$/.test(state.assessment_worker_digest||''))throw Error('Active beta runtime differs from the approved release state.');
}
export async function verifyOpenBeta({env=process.env,fetchImpl=fetch}={}){
 if(env.SUPABASE_PROJECT_REF!==productionProject||!env.SUPABASE_ACCESS_TOKEN?.trim())throw Error('Pinned production verification context required.');
 const proof=JSON.parse(await readFile(new URL('../docs/open-beta-production-deployment.json',import.meta.url),'utf8'));
 if(proof.project!==productionProject||proof.mode!=='active_beta'||!Array.isArray(proof.files)||proof.files.length<51||
  !Array.isArray(proof.functions)||proof.functions.length!==releasedFunctions.length||new Set(proof.functions.map(f=>f.name)).size!==releasedFunctions.length||
  releasedFunctions.some(name=>!proof.functions.some(f=>f.name===name)))throw Error('Invalid approved deployment manifest.');
 for(const file of proof.files){
  if(!/^(assets|supabase\/functions)\/[\w./-]+$/.test(file.path)||file.path.includes('..')||!/^[a-f0-9]{64}$/.test(file.sha256))throw Error('Invalid deployment source identity.');
  if(digest(await readFile(new URL('../'+file.path,import.meta.url)))!==file.sha256)throw Error('Deployed release source changed: '+file.path);
 }
 async function request(url,options={}){
  try{return await fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.timeout(30000)});}
  catch{throw Error('Production verification request failed; private response withheld.');}
 }
 async function api(path,query){
  const r=await request(`https://api.supabase.com/v1/projects/${productionProject}${path}`,{method:query?'POST':'GET',
   headers:{Authorization:'Bearer '+env.SUPABASE_ACCESS_TOKEN.trim(),'Content-Type':'application/json'},...(query?{body:JSON.stringify({query})}:{})});
  if(!r.ok)throw Error('Production evidence unavailable (HTTP '+r.status+'); private response withheld.');
  try{return await r.json();}catch{throw Error('Invalid production evidence response.');}
 }
 const state=async()=>{const [value]=await api('/database/query',betaStateSQL);assertBetaState(value);return value;};
 const before=await state(),secrets=await api('/secrets');
 for(const [name,value] of Object.entries(betaConfiguration))if(secrets.filter(s=>s.name===name&&s.value===digest(value)).length!==1)throw Error('Runtime configuration differs: '+name);
 for(const [name,value] of [['BILLING_RECONCILE_SECRET',before.billing_worker_digest],['JOB_REASSESSMENT_SECRET',before.assessment_worker_digest]]){
  if(secrets.filter(s=>s.name===name&&s.value===value).length!==1)throw Error('Runtime and Vault credential digests differ: '+name);
 }
 const deployed=await api('/functions');
 for(const expected of proof.functions){
  const found=deployed.filter(f=>f.slug===expected.name);
  if(found.length!==1||found[0].status!=='ACTIVE'||found[0].verify_jwt!==expected.verify_jwt||found[0].ezbr_sha256!==expected.ezbr_sha256)throw Error('Deployed function differs: '+expected.name);
 }
 const migrations=JSON.parse(await readFile(new URL('./billing-production-migrations.json',import.meta.url),'utf8'));
 const history=await api('/database/query',"select version,name,md5(array_to_string(statements,E'\\n')) as md5 from supabase_migrations.schema_migrations order by version");
 validateHistory(history,migrations,{complete:true});
 if(migrations.some(m=>history.find(r=>r.version===m.version).md5!==m.md5))throw Error('Production migration source mismatch.');
 const base=`https://${productionProject}.supabase.co/functions/v1/`;
 const post=(name,body)=>request(base+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const status=await post('billing-sandbox',{action:'status'});
 if(!status.ok||(await status.json()).enabled!==false)throw Error('Billing unexpectedly enabled.');
 if((await post('billing-sandbox',{action:'checkout',tier:'basic'})).status!==404)throw Error('Closed checkout accepted acquisition.');
 for(const name of ['stripe-webhook','billing-reconcile'])if((await post(name,{})).ok)throw Error('Closed billing route accepted a request: '+name);
 for(const name of ['analyze-patterns-beta','reassess-job'])if((await post(name,{})).status!==401)throw Error('Analysis authentication boundary changed: '+name);
 const after=await state();
 if(JSON.stringify(after)!==JSON.stringify(before))throw Error('Runtime changed during verification.');
 return {project:productionProject,active_beta_verified:true,source_files:proof.files.length,functions:proof.functions.length,ai_enabled:true,checkout_enabled:false,management_writes:0,provider_calls_made:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)verifyOpenBeta().then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});
