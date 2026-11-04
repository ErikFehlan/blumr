const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const modules=import('../scripts/open-beta-production-verify.mjs');
const proof=JSON.parse(fs.readFileSync('docs/open-beta-production-deployment.json','utf8'));
const history=JSON.parse(fs.readFileSync('scripts/billing-production-migrations.json','utf8')).map(({version,name,md5})=>({version,name,md5}));
const env={SUPABASE_PROJECT_REF:'zqiqjzxcpznhzjengfff',SUPABASE_ACCESS_TOKEN:'synthetic-private-token'};
const state=()=>({health:Object.fromEntries(['pending_risk','oldest_risk_seconds','pending_receipts','oldest_receipt_seconds','worker_errors','risk_errors','unreviewed_risks','active_subscriptions','overdue_customers'].map(k=>[k,0])),
 ai_paused:false,ai_workers_active:true,billing_worker_paused:true,cleanup_active:true,subscription_accounts:0,ledger_isolation:true,billing_worker_digest:'a'.repeat(64),assessment_worker_digest:'b'.repeat(64)});
async function transport(fault){
 const {betaConfiguration,betaStateSQL}=await modules,calls=[];let states=0;
 const fetchImpl=async(url,options)=>{
  calls.push({url,options});const parsed=new URL(url);let value;
  if(parsed.hostname==='api.supabase.com'){
   assert.equal(options.headers.Authorization,'Bearer synthetic-private-token');
   if(parsed.pathname.endsWith('/database/query')){
    assert.equal(options.method,'POST');const query=JSON.parse(options.body).query;assert.match(query,/^select\b/);
    if(query===betaStateSQL){const row=state();states++;if(fault==='state_changed'&&states===2)row.assessment_worker_digest='c'.repeat(64);value=[row];}
    else{assert.match(query,/^select version,name,md5/);value=fault==='missing_migration'?history.slice(1):history;}
   }else{
    assert.equal(options.method,'GET','Verifier attempted a management write');
    if(parsed.pathname.endsWith('/secrets')){
     value=[...Object.entries(betaConfiguration).map(([name,v])=>({name,value:crypto.createHash('sha256').update(v).digest('hex')})),{name:'BILLING_RECONCILE_SECRET',value:'a'.repeat(64)},{name:'JOB_REASSESSMENT_SECRET',value:'b'.repeat(64)}];
     if(fault==='paused_provider')value.find(v=>v.name==='AI_PROVIDER_CALLS_DISABLED').value=crypto.createHash('sha256').update('true').digest('hex');
     if(fault==='missing_configuration')value.pop();
    }else if(parsed.pathname.endsWith('/functions')){
     value=proof.functions.map(f=>({...f,slug:f.name,status:'ACTIVE'}));
     if(fault==='wrong_bundle')value.find(f=>f.name==='reassess-job').ezbr_sha256='0'.repeat(64);
     if(fault==='auth_changed')value.find(f=>f.name==='analyze-patterns-beta').verify_jwt=false;
    }else throw Error('Unexpected management endpoint');
   }
  }else{
   assert.equal(parsed.hostname,'zqiqjzxcpznhzjengfff.supabase.co');assert.equal(options.method,'POST');assert.equal(options.headers.Authorization,undefined);
   const name=parsed.pathname.split('/').at(-1),body=JSON.parse(options.body);
   if(name==='billing-sandbox'&&body.action==='status')value={enabled:fault==='billing_enabled'};
   else if(name==='billing-sandbox'){assert.deepEqual(body,{action:'checkout',tier:'basic'});return new Response('{}',{status:fault==='checkout_open'?200:404});}
   else{assert.deepEqual(body,{});assert.ok(['stripe-webhook','billing-reconcile','analyze-patterns-beta','reassess-job'].includes(name));return new Response('{}',{status:fault==='unauthenticated_access'?200:401});}
  }
  return new Response(JSON.stringify(value),{status:200});
 };
 return {fetchImpl,calls};
}
test('active beta proof checks deployed code and live controls without management writes or paid calls',async()=>{
 const {verifyOpenBeta}=await modules,{fetchImpl,calls}=await transport();
 const result=await verifyOpenBeta({env,fetchImpl});assert.equal(result.active_beta_verified,true);assert.equal(result.management_writes,0);assert.equal(result.provider_calls_made,0);
 assert.ok(calls.some(c=>c.url.endsWith('/functions')));assert.equal(calls.filter(c=>c.url.endsWith('/database/query')).length,3);
});
for(const [fault,message] of Object.entries({paused_provider:/Runtime configuration differs/,missing_configuration:/credential digests differ/,wrong_bundle:/Deployed function differs/,auth_changed:/Deployed function differs/,missing_migration:/migration installation is incomplete/,billing_enabled:/Billing unexpectedly enabled/,checkout_open:/Closed checkout accepted/,unauthenticated_access:/Closed billing route accepted/,state_changed:/Runtime changed/}))test('active beta proof rejects '+fault,async()=>{
 const {verifyOpenBeta}=await modules,{fetchImpl}=await transport(fault);await assert.rejects(verifyOpenBeta({env,fetchImpl}),message);
});
test('active beta proof rejects paused AI, worker changes, enrollment and ledger drift',async()=>{
 const {assertBetaState}=await modules;
 for(const [key,value] of Object.entries({ai_paused:true,ai_workers_active:false,billing_worker_paused:false,cleanup_active:false,subscription_accounts:1,ledger_isolation:false,billing_worker_digest:null,assessment_worker_digest:null}))assert.throws(()=>assertBetaState({...state(),[key]:value}),key);
 const risk=state();risk.health.worker_errors=1;assert.throws(()=>assertBetaState(risk));
});
test('verification is pinned to production and does not expose a failed private request',async()=>{
 const {verifyOpenBeta}=await modules;await assert.rejects(verifyOpenBeta({env:{...env,SUPABASE_PROJECT_REF:'foreign'},fetchImpl:()=>{throw Error('must not call');}}),/Pinned production/);
 await assert.rejects(verifyOpenBeta({env,fetchImpl:()=>{throw Error('synthetic-private-token');}}),e=>!e.message.includes('synthetic-private-token')&&e.message.includes('private response withheld'));
});
test('active beta publication needs explicit production proof plus every validator',async()=>{
 const {releaseDecision}=await import('../scripts/cloudflare-release-gate.mjs');
 const checks=['validate','validate','validate','validate','core-backend / validate','runtime-proof / verify'].map(name=>({name,status:'completed',conclusion:'success'}));
 assert.equal(releaseDecision(checks),'passed');assert.equal(releaseDecision(checks.slice(1)),'pending');
 for(const conclusion of ['failure','cancelled','timed_out'])assert.equal(releaseDecision(checks.map(c=>c.name==='runtime-proof / verify'?{...c,conclusion}:c)),'failed');
 assert.notEqual(releaseDecision(checks.map(c=>c.name==='runtime-proof / verify'?{...c,conclusion:'skipped'}:c)),'passed');
 assert.equal(releaseDecision(checks.map(c=>c.name==='runtime-proof / verify'?{...c,status:'in_progress',conclusion:null}:c)),'pending');
 assert.equal(releaseDecision([...checks,{name:'closed-billing / verify',status:'completed',conclusion:'success'}]),'failed');
});
