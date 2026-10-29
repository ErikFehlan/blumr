import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
export const PROJECT='momfzjmycveqginxmqib',RUN='20261029-v1';
const base=`https://${PROJECT}.supabase.co`,app='https://feat-subscription-foundation.blumr.pages.dev';
const migration='20261029171215_subscription_billing_readiness',version='2026-09-30.endive';
export async function runReadiness(mode,env=process.env){
 assert(['migrate','preflight','edges','risk','monitor','restore','stop'].includes(mode),'Invalid readiness mode');
 assert.equal(env.SUPABASE_PROJECT_REF,PROJECT);assert(env.SUPABASE_ACCESS_TOKEN?.trim(),'Staging management credential required');
 assert(/^rk_test_[A-Za-z0-9]+$/.test(env.STRIPE_BILLING_SANDBOX_KEY||''),'Restricted sandbox key required');
 const key=env.STRIPE_BILLING_SANDBOX_KEY,sessions=[];
 async function request(url,init={},expected=[200,201,204]){
  assert(['https://api.supabase.com','https://api.stripe.com',base].includes(new URL(url).origin));
  let r;try{r=await fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(45000)});}catch{throw Error('Readiness transport failed; credentials and response withheld');}
  if(!expected.includes(r.status))throw Error(`Readiness HTTP ${r.status}: ${new URL(url).pathname}; response withheld`);
  return {status:r.status,data:await r.json().catch(()=>null)};
 }
 const management=async(path,method='GET',body,token=env.SUPABASE_ACCESS_TOKEN)=> (await request(`https://api.supabase.com/v1/projects/${PROJECT}${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})).data;
 const sql=(query,parameters=[])=>management('/database/query','POST',{query,parameters});
 const stripe=async(path)=> (await request('https://api.stripe.com/v1/'+path,{headers:{Authorization:`Bearer ${key}`,'Stripe-Version':version}})).data;
 const baseline=async()=> (await sql(`select jsonb_build_object('usage',(select count(*) from public.ai_provider_usage),'ai_paused',(select ai_paused from public.security_limits where id=true),'ai_crons_paused',(select count(*)=2 and bool_and(not active) from cron.job where jobname in ('ancalagon-criteria-worker','ancalagon-job-reassessment')),'foreign_accounts',(select count(*) from public.subscription_accounts a join auth.users u on u.id=a.user_id where coalesce(u.raw_app_meta_data->>'billing_validation','')<>$1)) as value`,[RUN]))[0].value;
 const before=await baseline();assert.deepEqual(before,{usage:8,ai_paused:true,ai_crons_paused:true,foreign_accounts:0});
 if(mode==='migrate')await management('/secrets','POST',[{name:'AI_PROVIDER_CALLS_DISABLED',value:'true'}]);
 const matchesSecret=(s,name,value)=>s.name===name&&(!s.digest||s.digest===createHash('sha256').update(value).digest('hex'));
 const secrets=await management('/secrets');assert(secrets.some(s=>matchesSecret(s,'AI_PROVIDER_CALLS_DISABLED','true')),'AI runtime lock missing');
 const source=await readFile(new URL('../supabase/migrations/'+migration+'.sql',import.meta.url),'utf8'),hash=createHash('md5').update(source).digest('hex');
 const history=await sql('select version,md5(array_to_string(statements,E\'\\n\')) as hash from supabase_migrations.schema_migrations where name=$1',[migration.slice(15)]);
 if(mode==='migrate'){
  assert.equal((await sql("select bool_and(not active) as paused from cron.job where jobname in ('blumr-billing-reconcile','ancalagon-criteria-worker','ancalagon-job-reassessment')"))[0].paused,true);
  if(!history.length){assert(env.SUPABASE_STAGING_MIGRATION_TOKEN,'Staging-only migration token required');await management('/database/migrations','POST',{name:migration.slice(15),query:source},env.SUPABASE_STAGING_MIGRATION_TOKEN);}
  const applied=await sql('select version,md5(array_to_string(statements,E\'\\n\')) as hash from supabase_migrations.schema_migrations where name=$1',[migration.slice(15)]);
  assert.equal(applied.length,1);assert.equal(applied[0].hash,hash);
  if(applied[0].version!==migration.slice(0,14))await sql('update supabase_migrations.schema_migrations set version=$1 where version=$2 and name=$3 and md5(array_to_string(statements,E\'\\n\'))=$4',[migration.slice(0,14),applied[0].version,migration.slice(15),hash]);
  assert.deepEqual(await baseline(),before);console.log(JSON.stringify({case:'readiness_migration',checksum:hash,project:PROJECT,provider_usage:8}));return;
 }
 assert.equal(history.length,1,'Readiness migration required');assert.equal(history[0].hash,hash,'Migration source mismatch');
 const keys=await management('/api-keys?reveal=true'),service=keys.find(k=>k.name==='service_role')?.api_key,anon=keys.find(k=>k.name==='anon')?.api_key;assert(service&&anon);
 const call=async(path,access,body,expected=[200,201,204])=>(await request(base+path,{method:'POST',headers:{apikey:access===service?service:anon,Authorization:`Bearer ${access}`,'Content-Type':'application/json',Origin:app},body:JSON.stringify(body)},expected));
 const risk=async(action,args={})=>(await call('/rest/v1/rpc/subscription_billing_risk_command',service,{p_action:action,p_args:args})).data;
 const workerSecret=(await sql("select decrypted_secret from vault.decrypted_secrets where name='billing_staging_reconcile_secret'"))[0].decrypted_secret;
 const billing=(access,action,tier,expected)=>call('/functions/v1/billing-sandbox',access,{action,...(tier?{tier}:{})},expected);
 const enable=enabled=>management('/secrets','POST',[{name:'AI_PROVIDER_CALLS_DISABLED',value:'true'},{name:'STRIPE_BILLING_SANDBOX_ENABLED',value:String(enabled)},{name:'SUBSCRIPTION_FOUNDATION_ENABLED',value:String(enabled)},{name:'STRIPE_CHECKOUT_PAUSED',value:'false'}]);
 async function login(fixture){
  const email=`blumr-billing-${RUN}-${fixture}@example.invalid`,password=createHmac('sha256',key).update(`blumr-billing-fixture:${PROJECT}:${email}`).digest('base64url');
  const session=(await call('/auth/v1/token?grant_type=password',anon,{email,password})).data;assert.equal(session.user.app_metadata.billing_validation,RUN);sessions.push(session.access_token);return session;
 }
 const worker=async(expected=[200])=>call('/functions/v1/billing-reconcile',workerSecret,{},expected);
 const schedule=()=>sql("update blumr_billing_private.customers set next_reconcile_at=now() where coalesce(lease_until,'-infinity')<now()");
 try{
  if(mode==='preflight'){
   // Verify the one additional read permission with a known sandbox charge.
   const charge=await stripe('charges/ch_3UVvZJClb9pZVTfu1mjE8b5s');assert.equal(charge.livemode,false);assert.equal(charge.customer,'cus_VWzIFSxAUnfCza');
   const pay=await stripe('invoice_payments?payment[type]=payment_intent&payment[payment_intent]=pi_3UVvZJClb9pZVTfu1QQIDSQH&limit=100');assert(pay.data.some(p=>p.invoice==='in_1UVvZGClb9pZVTfu7x2dItYS'));
   console.log(JSON.stringify({case:'restricted_risk_read',charges:true,invoice_payments:true}));
  }else if(mode==='edges'){
   await enable(true);
   const session=await login('basic');const access=session.access_token;
   const start=await billing(access,'checkout','basic');assert(new URL(start.data.url).origin==='https://checkout.stripe.com');
   const retry=await billing(access,'checkout','basic');assert.equal(retry.data.url,start.data.url);
   const mapping=(await sql('select checkout_session,checkout_id from blumr_billing_private.customers where user_id=$1',[session.user.id]))[0];
   const count=(await sql('select count(*)::int as count from public.subscription_periods'))[0].count;
   // Browser abandoned checkout: no success redirect or payment grants access.
   const status=await billing(access,'status');assert.equal(status.data.pending,true);
   assert.equal((await sql('select count(*)::int as count from public.subscription_periods'))[0].count,count);
   console.log(JSON.stringify({case:'abandoned_checkout',session:mapping.checkout_session,periods_unchanged:true}));
   // Revoke this actual fixture session and replay its formerly valid JWT.
   await call('/auth/v1/logout?scope=local',access,{});
   await billing(access,'portal',undefined,[401]);await billing(access,'checkout','basic',[401]);
   console.log(JSON.stringify({case:'revoked_session',checkout:401,portal:401}));
   // A bounded invalid sandbox credential simulates a provider authentication
   // outage; restore the original key in finally, never weakening the AI guard.
   await schedule();
   const ledger=(await sql("select jsonb_build_object('accounts',(select jsonb_agg(to_jsonb(a)-'admin_revision' order by id) from public.subscription_accounts a),'periods',(select jsonb_agg(to_jsonb(p) order by id) from public.subscription_periods p)) as value"))[0].value;
   try{await management('/secrets','POST',[{name:'STRIPE_SECRET_KEY',value:'rk_test_readinessUnavailable'}]);await worker([503]);}
   finally{await management('/secrets','POST',[{name:'STRIPE_SECRET_KEY',value:key}]);}
   assert.deepEqual((await sql("select jsonb_build_object('accounts',(select jsonb_agg(to_jsonb(a)-'admin_revision' order by id) from public.subscription_accounts a),'periods',(select jsonb_agg(to_jsonb(p) order by id) from public.subscription_periods p)) as value"))[0].value,ledger);
   await schedule();for(let i=0;i<4;i++)await worker();
   console.log(JSON.stringify({case:'provider_outage_recovery',ledger_preserved:true,retry_succeeded:true}));
  }else if(mode==='risk'){
   await enable(true);await worker();console.log(JSON.stringify({case:'risk_health',...await risk('health')}));
  }else if(mode==='monitor'){
   const health=await risk('health');console.log(JSON.stringify({case:'billing_health',...health}));
   assert(health.oldest_risk_seconds<300&&health.oldest_receipt_seconds<300&&health.worker_errors===0&&health.risk_errors===0&&health.overdue_customers===0&&health.unreviewed_risks===0,'Billing requires operator review');
  }else if(mode==='stop'){
   const mappings=await sql('select customer_id from blumr_billing_private.customers');
   for(const m of mappings){const list=await stripe('subscriptions?customer='+m.customer_id+'&status=all&limit=100');assert(!list.has_more&&list.data.every(s=>['canceled','incomplete_expired'].includes(s.status)),'Cancel test subscriptions first');}
   const health=await risk('health');assert.equal(health.pending_risk,0);assert.equal(health.pending_receipts,0);
   await sql("select cron.alter_job(jobid,active:=false) from cron.job where jobname='blumr-billing-reconcile'");await enable(false);
   const settings=await management('/secrets');for(const [name,value] of [['AI_PROVIDER_CALLS_DISABLED','true'],['STRIPE_BILLING_SANDBOX_ENABLED','false'],['SUBSCRIPTION_FOUNDATION_ENABLED','false']])assert(settings.some(s=>matchesSecret(s,name,value)));
   assert.equal((await billing(service,'status')).data.enabled,false);console.log(JSON.stringify({case:'shutdown',flags_verified:true}));
  }else if(mode==='restore'){
   throw Error('Restore runner not yet implemented');
  }
  assert.deepEqual(await baseline(),before);console.log(JSON.stringify({mode,project:PROJECT,provider_usage:8,paid_ai_disabled:true}));
 }finally{for(const access of sessions)await call('/auth/v1/logout?scope=local',access,{}).catch(()=>{});}
}
if(process.argv[1]?.endsWith('billing-readiness-staging.mjs'))runReadiness(process.argv[2]).catch(e=>{console.error(e.message);process.exitCode=1;});
