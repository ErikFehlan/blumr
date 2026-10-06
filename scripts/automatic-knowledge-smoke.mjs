import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
// Called only with the disposable users created by core-live-smoke. All records
// are synthetic, explicitly owned, and removed even when a check fails.
export async function checkAutomaticKnowledge(req,owner,other){
 const jobs=[randomUUID(),randomUUID(),randomUUID()],candidates=[randomUUID(),randomUUID(),randomUUID()];
 try{
  await req('/rest/v1/jobs',owner.access,'POST',jobs.slice(0,2).map((id,i)=>({id,workspace_id:owner.workspace,title:i?'Software Engineer':'Java Developer',client:'Synthetic knowledge client',status:'closed',created_by:owner.id})));
  await req('/rest/v1/candidates',owner.access,'POST',candidates.map((id,i)=>({id,workspace_id:owner.workspace,job_id:jobs[i===2?1:0],name:'Synthetic knowledge '+i,created_by:owner.id})));
  await req('/rest/v1/manager_feedback',owner.access,'POST',candidates.map((id,i)=>({id:randomUUID(),workspace_id:owner.workspace,job_id:jobs[i===2?1:0],candidate_id:id,feedback_type:'Interview feedback',feedback_text:'Interview confirmed RabbitMQ experience transferred to Kafka for event processing case '+i,created_by:owner.id})));
  await req('/rest/v1/jobs',owner.access,'POST',{id:jobs[2],workspace_id:owner.workspace,title:'Backend Developer',client:'Synthetic knowledge client',status:'closed',criteria:['Kafka'],created_by:owner.id});
  const items=(await req('/rest/v1/rpc/get_automatic_job_knowledge',owner.access,'POST',{p_job:jobs[2]})).data;
  assert.equal(items.length,1,'New job did not reuse confirmed learning automatically');
  assert.equal(items[0].supporting_candidates,3);assert.equal(items[0].supporting_jobs,2);
  assert.match(items[0].text,/partial credit/);
  assert.equal((await req('/rest/v1/rpc/get_automatic_job_knowledge',other.access,'POST',{p_job:jobs[2]},false)).status,403,'Automatic context crossed accounts');
  assert.equal((await req('/rest/v1/rpc/exclude_automatic_job_knowledge',other.access,'POST',{p_job:jobs[2],p_rule:items[0].rule_key},false)).status,403,'Foreign exclusion succeeded');
  await req('/rest/v1/rpc/exclude_automatic_job_knowledge',owner.access,'POST',{p_job:jobs[2],p_rule:items[0].rule_key});
  assert.deepEqual((await req('/rest/v1/rpc/get_automatic_job_knowledge',owner.access,'POST',{p_job:jobs[2]})).data,[],'Single-action exclusion failed');
  assert.equal((await req('/rest/v1/ai_usage_events?workspace_id=eq.'+owner.workspace+'&select=id',owner.access)).data.length,0,'Learning capture or retrieval called AI');
  console.log('PASS: live automatic feedback learning, new-job reuse, private scope and one-action exclusion with zero AI calls.');
 }finally{
  await req('/rest/v1/jobs?workspace_id=eq.'+owner.workspace+'&id=in.('+jobs.join(',')+')',owner.access,'DELETE');
 }
}
