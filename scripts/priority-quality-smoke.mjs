import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {managementFetch} from './supabase-management.mjs';
import {priorityCases,checkPriorityCase} from '../tests/fixtures/priority-quality.mjs';
const token=process.env.SUPABASE_ACCESS_TOKEN,ref=process.env.SUPABASE_PROJECT_REF;
if(ref!=='momfzjmycveqginxmqib'||!token)throw Error('Run this synthetic quality check in the existing isolated staging environment.');
const base=`https://${ref}.supabase.co`;
async function management(path,method='GET',body){const r=await managementFetch(`https://api.supabase.com/v1/projects/${ref}${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(`Staging setup failed (${r.status})`);return r.json();}
const query=(query,parameters=[])=>management('/database/query','POST',{query,parameters});
const keys=await management('/api-keys?reveal=true'),service=keys.find(k=>k.name==='service_role')?.api_key,anon=keys.find(k=>k.name==='anon')?.api_key;assert.ok(service&&anon);
async function request(path,method='GET',body,access=service){const r=await fetch(base+path,{method,headers:{apikey:access===service?service:anon,Authorization:`Bearer ${access}`,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(115000)});const result=await r.json().catch(()=>null);if(!r.ok)throw Error(`Priority verification failed (${r.status}, ${result?.code||'request'})`);return result;}
const email=`blumr-priority-check-${randomUUID()}@example.invalid`,password=randomBytes(32).toString('base64url');let user,workspace;const report=[];
try{
 await query('insert into public.beta_access(email) values($1)',[email]);
 const created=await request('/auth/v1/admin/users','POST',{email,password,email_confirm:true});user=created.id||created.user?.id;
 workspace=(await request('/rest/v1/workspace_members?select=workspace_id&user_id=eq.'+user))[0].workspace_id;
 const session=await request('/auth/v1/token?grant_type=password','POST',{email,password},anon),access=session.access_token;assert.ok(access);
 for(const test of priorityCases){
  const body={workspace_id:workspace,analysis_type:'hiring_priorities',job:test.job};
  const started=Date.now(),draft=await request('/functions/v1/analyze-patterns-beta','POST',body,access);checkPriorityCase(test,draft.items,assert);
  const cached=await request('/functions/v1/analyze-patterns-beta','POST',body,access);assert.equal(cached.draft_id,draft.draft_id,'Repeated setup did not reuse the saved result');
  const id=randomUUID();await request('/rest/v1/jobs','POST',{id,workspace_id:workspace,title:test.job.title,description:test.job.description,manager_feedback:test.job.manager_notes||'',criteria:[],knockouts:[],priority_draft_id:draft.draft_id,priority_draft_edits:draft.items,created_by:user},access);
  const saved=await request('/rest/v1/rpc/get_job_hiring_priorities','POST',{p_job:id},access);assert.deepEqual(saved.items,draft.items,'Saved job has a different list');
  report.push({case:test.name,duration_ms:Date.now()-started,items:draft.items});console.log('PRIORITY_QUALITY '+JSON.stringify(report.at(-1)));
 }
 await mkdir('test-results/priorities',{recursive:true});await writeFile('test-results/priorities/quality.json',JSON.stringify(report,null,2));
 console.log('PASS six role-quality cases, durable reuse and exact setup-to-job persistence.');
}finally{
 if(workspace)await query('delete from public.workspaces where id=$1',[workspace]);
 if(user)await request('/auth/v1/admin/users/'+user,'DELETE');
 await query('delete from public.beta_access where email=$1 and user_id is null',[email]);
 if(workspace)await query('delete from public.ai_budget_counters where scope=$1 or scope=$2',['workspace:'+workspace,'user:'+user]);
}
