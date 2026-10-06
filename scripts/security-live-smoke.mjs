// Synthetic-only, no email delivery and no paid model calls.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
const token=process.env.SUPABASE_ACCESS_TOKEN,ref=process.env.SUPABASE_PROJECT_REF;
if(!token||!/^[a-z0-9]{20}$/.test(ref||''))throw Error('Live security checks require the deployment environment.');
const base=`https://${ref}.supabase.co`;
async function management(query,parameters=[]){const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query,parameters}),signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Synthetic security setup failed ('+r.status+')');return r.json();}
const kr=await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});if(!kr.ok)throw Error('Security check credential access failed');
const keys=await kr.json(),service=keys.find(k=>k.name==='service_role')?.api_key,anon=keys.find(k=>k.name==='anon')?.api_key;
if(!service||!anon)throw Error('Security check configuration unavailable');
async function req(path,access=anon,method='GET',body){const r=await fetch(base+path,{method,headers:{apikey:access===service?service:anon,Authorization:'Bearer '+access,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});return {ok:r.ok,status:r.status,data:await r.json().catch(()=>null)};}
const email=`ancalagon-security-${randomUUID()}@example.invalid`,password=randomBytes(32).toString('base64url');let user,workspace;
try{
 await management(await readFile('tests/open-beta-signup-live.sql','utf8'));
 // Generate the normal confirmation token without delivering an email. No
 // beta_access record is inserted: both Auth creation and its DB trigger run.
 const created=await req('/auth/v1/admin/generate_link',service,'POST',{type:'signup',email,password});
 assert.ok(created.ok,'Self-service synthetic account creation failed');user=created.data.id||created.data.user?.id;assert.ok(user);
 const unverified=await req('/auth/v1/token?grant_type=password',anon,'POST',{email,password});assert.ok(!unverified.ok,'Unverified account could sign in');
 assert.equal(unverified.data.error_code,'email_not_confirmed');
 const hash=created.data.hashed_token||created.data.properties?.hashed_token;assert.ok(hash,'Confirmation token missing');
 const verified=await req('/auth/v1/verify',anon,'POST',{type:'signup',token_hash:hash});
 assert.ok(verified.ok&&verified.data.access_token,'Email confirmation failed');
 const replay=await req('/auth/v1/verify',anon,'POST',{type:'signup',token_hash:hash});assert.ok(!replay.ok,'Confirmation link was reusable');
 const login=await req('/auth/v1/token?grant_type=password',anon,'POST',{email,password});assert.ok(login.ok);const access=login.data.access_token;
 const memberships=await req('/rest/v1/workspace_members?select=workspace_id&user_id=eq.'+user,access);assert.equal(memberships.data.length,1);workspace=memberships.data[0].workspace_id;
 for(const [op,body] of [['get_beta_security',{}],['manage_beta_access',{p_email:email,p_approved:true}],['set_ai_paused',{p_paused:true}],['reserve_ai_budget',{p_workspace:workspace,p_actor:user,p_input_bytes:100,p_output_tokens:100}]]){
  assert.ok(!(await req('/rest/v1/rpc/'+op,access,'POST',body)).ok,'Non-admin security RPC accepted: '+op);
 }
 assert.ok(!(await req('/rest/v1/beta_access?select=email',access)).ok,'Account controls exposed');
 const plans=await req('/rest/v1/workspace_plans?select=plan,status&workspace_id=eq.'+workspace,access);
 assert.ok(plans.ok);assert.equal(plans.data[0]?.plan,'beta');assert.equal(plans.data[0]?.status,'active');

 // Exhaust only this disposable workspace's budget; leave global/user limits intact.
 await management("insert into public.ai_budget_counters(scope,period,window_start,calls) values($1,'day',date_trunc('day',now() at time zone 'UTC') at time zone 'UTC',2000)",["workspace:"+workspace]);
 const payload={workspace_id:workspace,analysis_type:'feedback',job:{title:'Synthetic'},feedback:{text:'Synthetic ownership question'}};
 for(const route of ['analyze-patterns-beta','analyze-patterns-v2']){
  const limited=await req('/functions/v1/'+route,access,'POST',payload);assert.equal(limited.status,429,'Direct analysis exceeded its budget');assert.equal(limited.data.code,'usage_limit');
 }
 await management('update public.beta_access set approved=false where user_id=$1',[user]);
 assert.equal((await req('/rest/v1/workspace_members?select=workspace_id',access)).data.length,0,'Existing JWT retained workspace access after revocation');
 assert.equal((await req('/functions/v1/analyze-patterns-beta',access,'POST',payload)).status,403,'Revoked account could call AI');
 console.log('PASS: live automatic registration without approval, confirmation-token login and replay denial, free beta plan, unverified-login denial, admin/credit tampering denial, both AI route quotas, and existing-session revocation. No email or model request sent.');
}finally{
 if(user){const removed=await req('/auth/v1/admin/users/'+user,service,'DELETE');if(!removed.ok)throw Error('Synthetic security user cleanup needs attention');}
 await management('delete from public.beta_access where email=$1 and user_id is null',[email]);
 if(workspace)await management('delete from public.ai_budget_counters where scope=$1 or scope=$2',['workspace:'+workspace,'user:'+user]);
}
