import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
// Closed jobs and synthetic worker results exercise triggers without model calls.
export async function checkInferenceLearning(req,worker,owner,other){
 const jobs=[randomUUID(),randomUUID(),randomUUID()],candidates=[];
 for(const heldOut of [false,true])while(candidates.filter(c=>c.heldOut===heldOut).length<(heldOut?3:12)){
  const id=randomUUID(),held=parseInt(createHash('md5').update(id).digest('hex').slice(0,8),16)%5===0;
  if(held===heldOut)candidates.push({id,heldOut:held});
 }
 try{
  await req('/rest/v1/jobs',owner.access,'POST',jobs.slice(0,2).map(id=>({id,workspace_id:owner.workspace,title:'Synthetic Accountant',status:'closed',criteria:['Financial close'],created_by:owner.id})));
  await req('/rest/v1/candidates',owner.access,'POST',candidates.map((c,i)=>({id:c.id,workspace_id:owner.workspace,job_id:jobs[i%2],name:'Synthetic inference '+i,created_by:owner.id})));
  const results=candidates.map((c,i)=>({candidate_id:c.id,workspace_id:owner.workspace,job_id:jobs[i%2],revision:'synthetic-inference-v2',input:{synthetic:true},status:'ready',result:{experience_profile:{version:'experience-intelligence-v2'},criteria_assessment:[{criterion:'Financial close',status:'partial',evidence_type:'inferred',inference_kind:'workflow',confidence_score:65,source_ids:['synthetic-resume']}]}}));
  assert.equal((await req('/rest/v1/resume_intake_tasks',owner.access,'POST',results.slice(0,1),false)).ok,false,'Client fabricated inference predictions');
  await worker('/rest/v1/resume_intake_tasks','POST',results);
  const notes=candidates.map((c,i)=>({id:randomUUID(),workspace_id:owner.workspace,job_id:jobs[i%2],candidate_id:c.id,feedback_type:'Interview feedback',feedback_text:'Interview verified financial close through reconciliation exercise '+i,created_by:owner.id}));
  await req('/rest/v1/manager_feedback',owner.access,'POST',notes);
  const quality=(await req('/rest/v1/rpc/get_inference_learning_quality',owner.access,'POST',{p_workspace:owner.workspace})).data;
  assert.equal(quality.learning_confirmed,12);assert.equal(quality.held_out_confirmed,3);assert.equal(quality.unresolved,0);
  assert.equal((await req('/rest/v1/rpc/get_inference_learning_quality',other.access,'POST',{p_workspace:owner.workspace},false)).status,403);
  await req('/rest/v1/jobs',owner.access,'POST',{id:jobs[2],workspace_id:owner.workspace,title:'Synthetic Accountant',status:'closed',criteria:['Financial close'],created_by:owner.id});
  const items=(await req('/rest/v1/rpc/get_automatic_job_knowledge',owner.access,'POST',{p_job:jobs[2]})).data;
  assert.equal(items.length,1);assert.equal(items[0].inference_history.candidates,12,'Evaluation examples entered learning');
  assert.equal((await req('/rest/v1/rpc/get_assessment_lessons',owner.access,'POST',{p_job:jobs[2]})).data[0].inference_history.confirmed,12,'Direct assessment lost verified metadata');
  await req('/rest/v1/manager_feedback?id=eq.'+notes[0].id,owner.access,'PATCH',{feedback_text:'Interview confirmed no financial close experience.'});
  assert.deepEqual((await req('/rest/v1/rpc/get_automatic_job_knowledge',owner.access,'POST',{p_job:jobs[2]})).data,[],'Old positive snapshot survived correction');
  assert.equal((await req('/rest/v1/ai_usage_events?workspace_id=eq.'+owner.workspace+'&select=id',owner.access)).data.length,0,'Inference learning called AI');
  console.log('PASS: live role-neutral inference capture, later evidence, separate held-out cases, new-job reuse, correction invalidation and zero learning AI calls.');
 }finally{
  await req('/rest/v1/jobs?workspace_id=eq.'+owner.workspace+'&id=in.('+jobs.join(',')+')',owner.access,'DELETE');
 }
}
