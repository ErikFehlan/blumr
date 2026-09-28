// Bounded synthetic production canary. Never handles applicant data.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {dirname} from 'node:path';
import {PROJECT_REF} from './live-test-safety.mjs';

const operation=process.argv[2],file=process.env.CANARY_STATE_FILE;
if(!['create','run','cleanup'].includes(operation)||!file)throw Error('Specify canary operation and private state file');
const ref=process.env.SUPABASE_PROJECT_REF||PROJECT_REF;
assert.equal(ref,PROJECT_REF,'Unexpected project');
const base=`https://${ref}.supabase.co`;
const token=process.env.SUPABASE_ACCESS_TOKEN;
if(operation!=='run'&&!token)throw Error('Missing management credential');
const mask=value=>{if(process.env.GITHUB_ACTIONS&&value)console.log('::add-mask::'+value);};
let state;
try{state=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
if(operation==='create'){
 if(state)throw Error('Uncleaned fixture already exists');
 state={run:randomUUID(),project:ref,users:[],created_at:new Date().toISOString()};
 await mkdir(dirname(file),{recursive:true});
 await writeFile(file,JSON.stringify(state),{mode:0o600});
}else if(!state){if(operation==='cleanup'){console.log('No fixtures to clean');process.exit(0);}throw Error('Missing fixture state');}
assert.equal(state.project,ref);
const save=()=>writeFile(file,JSON.stringify(state),{mode:0o600});
async function management(query,parameters=[]){
 for(let attempt=0;attempt<6;attempt++){
  const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query,parameters}),signal:AbortSignal.timeout(30000)});
  if(r.ok)return r.json();
  if(r.status!==429||attempt===5)throw Error(`Database operation failed (${r.status})`);
  const retryAfter=Number(r.headers.get('retry-after'));
  const delay=Number.isFinite(retryAfter)&&retryAfter>0?Math.min(retryAfter*1000,30000):Math.min(2000*2**attempt,30000);
  await new Promise(resolve=>setTimeout(resolve,delay));
 }
}
let service,anon;
if(operation!=='run'){
 const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error(`Key lookup failed (${r.status})`);
 const keys=await r.json();service=keys.find(k=>k.name==='service_role')?.api_key;anon=keys.find(k=>k.name==='anon')?.api_key;
 assert.ok(service&&anon,'Missing backend keys');mask(service);mask(anon);
}
async function call(path,access,method='GET',body,timeout=20000){
 const started=performance.now();
 try{
  const r=await fetch(base+path,{method,headers:{apikey:access===service?service:state.anon,Authorization:`Bearer ${access}`,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});
  return {status:r.status,ms:Math.round(performance.now()-started),data:await r.json().catch(()=>null)};
 }catch(e){return {status:0,ms:Math.round(performance.now()-started),error:e.name};}
}
const fixtureEmail=i=>`blumr-load-${state.run}-${i}@example.invalid`;
if(operation==='create'){
 state.anon=anon;mask(anon);await save();
 for(let i=0;i<50;i++){
  const user={email:fixtureEmail(i),password:randomBytes(32).toString('base64url')};
  mask(user.password);state.users.push(user);await save();
  await management('insert into public.beta_access(email) values($1)',[user.email]);
  const created=await call('/auth/v1/admin/users',service,'POST',{email:user.email,password:user.password,email_confirm:true,user_metadata:{display_name:'Synthetic load canary',blumr_load_run:state.run}});
  assert.equal(created.status,200,'Synthetic account setup failed');
  user.id=created.data.id;assert.match(user.id,/^[0-9a-f-]{36}$/);await save();
  // The CI runner shares one IP for all fixtures. Stay under Auth's default
  // token refill rate; retry only the explicit 429 within this setup budget.
  await new Promise(resolve=>setTimeout(resolve,2300));
  let logged;
  for(let attempt=0;attempt<5;attempt++){
   logged=await call('/auth/v1/token?grant_type=password',anon,'POST',{email:user.email,password:user.password});
   if(logged.status!==429)break;
   await new Promise(resolve=>setTimeout(resolve,15000));
  }
  assert.equal(logged.status,200,'Synthetic login failed');user.access=logged.data.access_token;mask(user.access);
  const member=await call('/rest/v1/workspace_members?select=workspace_id&user_id=eq.'+user.id,user.access);
  assert.equal(member.status,200);assert.equal(member.data.length,1);user.workspace=member.data[0].workspace_id;await save();
 }
 assert.equal(new Set(state.users.map(u=>u.workspace)).size,50,'Workspaces were not isolated');
 console.log('Created 50 disposable users in 50 separate workspaces');
}else if(operation==='run'){
 assert.equal(state.users.length,50,'Incomplete fixture');
 const measurements=[];const percentile=(a,p)=>{const s=a.toSorted((x,y)=>x-y);return s[Math.min(s.length-1,Math.ceil(p*s.length)-1)]};
 for(const count of [5,25,50]){
 const users=state.users.slice(0,count);
  // All 50 users signed in during setup. A shared CI runner IP hits Supabase's
  // token-endpoint burst limit; existing sessions model simultaneous active users.
  const started=performance.now();
  const results=await Promise.all(users.map(async u=>{
   const a=await Promise.all(['/rest/v1/jobs?select=id&limit=5','/rest/v1/candidates?select=id&limit=5','/rest/v1/manager_feedback?select=id&limit=5'].map(p=>call(p,u.access)));
   return {user:u,requests:a};
  }));
  const reads=results.flatMap(r=>r.requests),failures=reads.filter(r=>r.status!==200);
  // AI is opt-in. Kickstarter readiness tests ordinary concurrent usage only.
  const ai=process.env.CANARY_AI==='1'?await Promise.all(users.slice(0,5).map(u=>call('/functions/v1/analyze-patterns-v2',u.access,'POST',{
   workspace_id:u.workspace,analysis_type:'screening',job:{title:'Synthetic load canary',description:'Evaluate manual testing experience.'},screening:{notes:'Synthetic candidate has manual regression testing experience; automation ownership is unverified.'}
  },90000))):[];
  const aiFailures=ai.filter(r=>r.status!==200);
  const cross=await call('/rest/v1/workspaces?select=id&id=eq.'+state.users[0].workspace,state.users[count-1].access);
  assert.equal(cross.status,200);assert.deepEqual(cross.data,[],'Cross-workspace leak: stop immediately');
  const metric={users:count,read_requests:reads.length,read_failures:failures.length,read_statuses:[...new Set(failures.map(r=>r.status))],read_p50_ms:percentile(reads.map(r=>r.ms),.5),read_p95_ms:percentile(reads.map(r=>r.ms),.95),read_p99_ms:percentile(reads.map(r=>r.ms),.99),ai_requests:ai.length,ai_failures:aiFailures.length,ai_statuses:[...new Set(aiFailures.map(r=>r.status))],ai_p95_ms:ai.length?percentile(ai.map(r=>r.ms),.95):null,elapsed_ms:Math.round(performance.now()-started)};
  measurements.push(metric);console.log('CANARY_METRIC '+JSON.stringify(metric));
  if(failures.length||aiFailures.length)break;
 }
 await mkdir('test-results/load',{recursive:true});await writeFile('test-results/load/results.json',JSON.stringify({date:new Date().toISOString(),scope:process.env.CANARY_AI==='1'?'production synthetic read burst and opt-in AI checks':'production synthetic read burst; no AI calls or resume uploads',measurements},null,2));
 if(measurements.at(-1).users!==50||measurements.some(m=>m.read_failures||m.ai_failures))process.exitCode=1;
}else{
 let failed=0;
 for(const [index,u] of state.users.entries()){
  try{
   assert.equal(u.email,fixtureEmail(index));
   const found=await management("select id from auth.users where email=$1 and raw_user_meta_data->>'blumr_load_run'=$2",[u.email,state.run]);
   if(found.length){assert.equal(found.length,1);if(u.id)assert.equal(found[0].id,u.id);
    const spaces=await call('/rest/v1/workspaces?select=id&owner_id=eq.'+found[0].id,service);assert.equal(spaces.status,200);
    for(const w of spaces.data){
     const members=await call('/rest/v1/workspace_members?select=user_id&workspace_id=eq.'+w.id,service);assert.equal(members.status,200);
     assert.ok(members.data.every(m=>m.user_id===found[0].id),'Unexpected member; refusing cleanup');
     const files=await management("select name from storage.objects where bucket_id='resumes' and name like $1",[w.id+'/%']);
     assert.equal(files.length,0,'Unexpected stored file; refusing cleanup');
     const removed=await call('/rest/v1/workspaces?id=eq.'+w.id,service,'DELETE');assert.ok(removed.status>=200&&removed.status<300,'Fixture workspace cleanup failed');
    }
    const deleted=await call('/auth/v1/admin/users/'+found[0].id,service,'DELETE');assert.ok(deleted.status>=200&&deleted.status<300);
   }
   await management('delete from public.beta_access where email=$1 and user_id is null',[u.email]);
  }catch(e){failed++;console.error('Cleanup needs attention at fixture index '+index+': '+e.message);}
 }
 if(failed)throw Error(`${failed} synthetic accounts need cleanup; private state retained`);
 await rm(file,{force:true});console.log('PASS: all 50 synthetic accounts and workspaces removed');
}
