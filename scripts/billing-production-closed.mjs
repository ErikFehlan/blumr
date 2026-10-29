import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export const productionProject='zqiqjzxcpznhzjengfff';
export const closedConfiguration=Object.freeze({
 BILLING_APP_URL:'https://blumr.io/',
 STRIPE_BILLING_MODE:'live',
 STRIPE_BILLING_SANDBOX_ENABLED:'false',
 STRIPE_BILLING_LIVE_ENABLED:'false',
 SUBSCRIPTION_FOUNDATION_ENABLED:'false',
 STRIPE_CHECKOUT_PAUSED:'true',
 STRIPE_LIVE_COHORT:'',
 AI_PROVIDER_CALLS_DISABLED:'true',
});
const checkpointSQL=`select jsonb_build_object(
 'ai_paused',(select ai_paused from public.security_limits limit 1),
 'workers_paused',(select count(*)=2 and bool_and(not active) from cron.job where jobname in ('ancalagon-criteria-worker','ancalagon-job-reassessment')),
 'provider_usage',(select count(*) from public.ai_provider_usage),
 'accounts_table',to_regclass('public.subscription_accounts') is not null
) as checkpoint`;

// This prepares an empty production billing installation. It never enrolls
// users, reads provider credentials, calls Stripe, runs DDL or enables workers.
export async function configureClosedProduction({env=process.env,fetchImpl=fetch,report=console.log,verifyOnly=false}={}) {
 if(env.SUPABASE_PROJECT_REF!==productionProject||!env.SUPABASE_ACCESS_TOKEN?.trim())throw Error('Closed setup requires the pinned production project and deployment token.');
 async function api(path,method='GET',body){
  let response;
  try{response=await fetchImpl(`https://api.supabase.com/v1/projects/${productionProject}${path}`,{
   method,headers:{Authorization:'Bearer '+env.SUPABASE_ACCESS_TOKEN.trim(),'Content-Type':'application/json'},
   ...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(30000),
  });}catch{throw Error('Production management request failed; private output withheld.');}
  if(!response.ok)throw Error(`Production management ${method} ${path} failed (HTTP ${response.status}); private output withheld.`);
  if(path==='/secrets'&&method==='POST'&&(response.status===201||response.status===204))return null;
  try{return await response.json();}catch{throw Error('Production management returned an invalid response.');}
 }
 async function checkpoint(){
  const state=(await api('/database/query','POST',{query:checkpointSQL}))[0]?.checkpoint;
  if(!state||state.ai_paused!==true||state.workers_paused!==true||!Number.isSafeInteger(state.provider_usage))throw Error('Database AI pause and both inactive AI workers are required.');
  if(state.accounts_table){
   const rows=await api('/database/query','POST',{query:'select count(*)::int as accounts from public.subscription_accounts'});
   if(rows[0]?.accounts!==0)throw Error('Closed installation refuses existing subscription accounts; use the subscriber-preserving rollback procedure.');
  }
  return state;
 }
 const before=await checkpoint();
 if(!verifyOnly)await api('/secrets','POST',Object.entries(closedConfiguration).map(([name,value])=>({name,value})));
 const metadata=await api('/secrets');
 for(const [name,value] of Object.entries(closedConfiguration)){
  const expected=createHash('sha256').update(value).digest('hex');
  if(metadata.filter(s=>s.name===name&&s.digest===expected).length!==1)throw Error('Production closed configuration digest did not match: '+name);
 }
 const after=await checkpoint();
 if(JSON.stringify(after)!==JSON.stringify(before))throw Error('Production state changed during configuration; release stopped.');
 const result={project:productionProject,closed_configuration_verified:true,checkout_enabled:false,subscription_foundation_enabled:false,ai_provider_calls_disabled:true,ai_workers_paused:true,provider_usage:after.provider_usage};
 report(JSON.stringify(result));return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 configureClosedProduction({verifyOnly:process.argv.includes('--verify-only')}).catch(error=>{console.error(error.message);process.exitCode=1;});
}
