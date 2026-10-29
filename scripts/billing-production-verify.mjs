import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {configureClosedProduction,productionProject} from './billing-production-closed.mjs';
import {validateHistory,releasedFunctions} from './billing-production-deploy.mjs';
import {assertBillingHealth} from './billing-health.mjs';
const token=process.env.SUPABASE_ACCESS_TOKEN;
if(!token||process.env.SUPABASE_PROJECT_REF!==productionProject)throw Error('Pinned production verification context required.');
const before=await configureClosedProduction({verifyOnly:true});
async function api(path,body){
 const r=await fetch(`https://api.supabase.com/v1/projects/${productionProject}${path}`,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error('Closed release evidence unavailable (HTTP '+r.status+'); private response withheld.');
 return r.json();
}
const manifest=JSON.parse(await readFile(new URL('./billing-production-migrations.json',import.meta.url),'utf8'));
const deployment=JSON.parse(await readFile(new URL('../docs/subscription-production-deployment.json',import.meta.url),'utf8'));
for(const file of deployment.files){
 const bytes=await readFile(new URL('../'+file.path,import.meta.url));
 if(createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error('Release source differs from verified deployed code: '+file.path);
}
const history=await api('/database/query',{query:"select version,name,md5(array_to_string(statements,E'\\n')) as md5 from supabase_migrations.schema_migrations order by version"});
validateHistory(history,manifest,{complete:true});
if(manifest.some(m=>history.find(r=>r.version===m.version).md5!==m.md5))throw Error('Production migration source mismatch.');
const functions=await api('/functions');
for(const name of releasedFunctions){
 const expected=deployment.functions.find(f=>f.name===name),actual=functions.find(f=>f.slug===name);
 if(!expected||!actual||actual.status!=='ACTIVE'||actual.ezbr_sha256!==expected.ezbr_sha256||actual.verify_jwt!==expected.verify_jwt)throw Error('Production function differs from the verified deployed source: '+name);
}
const [state]=await api('/database/query',{query:`select
 public.subscription_billing_risk_command('health','{}'::jsonb) as health,
 (select count(*)=3 and bool_and(not active) from cron.job where jobname in ('ancalagon-criteria-worker','ancalagon-job-reassessment','blumr-billing-reconcile')) as workers_paused,
 (select count(*)=13 and bool_and(c.relrowsecurity and not has_table_privilege('anon',c.oid,'select') and not has_table_privilege('authenticated',c.oid,'insert,update,delete')) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and ((n.nspname='public' and c.relname like 'subscription_%') or n.nspname='blumr_billing_private')) as ledger_isolation,
 (select encode(sha256(convert_to(decrypted_secret,'UTF8')),'hex') from vault.decrypted_secrets where name='billing_production_reconcile_secret') as worker_digest`});
assertBillingHealth(state.health);
if(Object.values(state.health).some(n=>n!==0)||!state.workers_paused||!state.ledger_isolation||!/^[a-f0-9]{64}$/.test(state.worker_digest||''))throw Error('Closed billing health, worker or ledger isolation differs from the approved state.');
const secrets=await api('/secrets');
if(!secrets.some(s=>s.name==='BILLING_RECONCILE_SECRET'&&s.value===state.worker_digest))throw Error('Runtime and Vault worker credential digests differ.');
const base=`https://${productionProject}.supabase.co/functions/v1/`;
const status=await fetch(base+'billing-sandbox',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'status'}),redirect:'error',signal:AbortSignal.timeout(30000)});
if(!status.ok||(await status.json()).enabled!==false)throw Error('Billing is not closed.');
for(const [name,body] of [['billing-sandbox',{action:'checkout',tier:'basic'}],['stripe-webhook',{}],['billing-reconcile',{}]]){
 const r=await fetch(base+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(30000)});
 if(r.ok)throw Error('Closed billing route unexpectedly accepted a request: '+name);
}
const after=await configureClosedProduction({verifyOnly:true});
if(after.provider_usage!==before.provider_usage||after.provider_usage!==deployment.provider_usage)throw Error('Production provider usage changed.');
console.log(JSON.stringify({closed_release_verified:true,migrations:manifest.length,functions:releasedFunctions.length,ledger_tables:13,checkout_enabled:false,workers_paused:true,provider_usage:after.provider_usage}));
