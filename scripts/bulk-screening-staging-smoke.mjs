// Real authenticated staging Storage/SQL/edge integration. Synthetic resumes;
// Deep analysis is limited to one explicit Top 20 and a $10 reservation cap.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {fixtures} from './readiness-fixtures.mjs';
import {screeningRead} from './screening-read-retry.mjs';
import {qualificationPools,qualificationJob} from '../tests/fixtures/screening-qualification-pools.mjs';
const mixed=process.env.BULK_MIXED_IMPORT==='1';
const f=await fixtures();
if(process.argv[2]==='cleanup'){await f.cleanup();await f.sql('update public.screening_feature_config set enabled=false');process.exit(0);}
const report={scope:'Authenticated staging, 500 synthetic TXT imports through bulk RPCs, real Storage and rules engine. One selected Top 20 uses the existing real provider with a $10 reservation cap. Synthetic evidence checks do not establish recruiter-labeled accuracy.',started_at:new Date().toISOString(),runs:[],snapshot_retries:0,passed:false};
const rpc=async(user,name,args)=> (await f.request('/rest/v1/rpc/'+name,user.access,'POST',args)).data;
const snapshot=async(user,batch,action='refresh')=>{const response=await screeningRead(()=>f.request('/functions/v1/analyze-patterns-beta',user.access,'POST',{analysis_type:'bulk_screening',workspace_id:user.workspace,batch_id:batch,action},false),{onRetry:status=>{report.snapshot_retries++;console.log('Retrying idempotent screening read: '+status);}});if(!response.ok)throw Error('Screening read failed after bounded recovery: '+response.status);return response.data;};
let originalError;
try{
 const state=await f.create(),user=state.users[0],foreign=state.users[1],job=randomUUID(),draft=randomUUID();
 let batch=randomUUID(),rows,manifestCount=501;
 const pool=qualificationPools.find(p=>p.id==='qa'),canonical=qualificationJob(pool,user.workspace,job),items=canonical.priorities.items;
 await f.sql('update public.screening_feature_config set enabled=true');
 await f.sql('insert into public.hiring_priority_drafts(id,workspace_id,actor_id,fingerprint,input,items,model) values($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)',[draft,user.workspace,user.id,'b'.repeat(64),JSON.stringify({title:canonical.job.title,description:canonical.job.description,manager_notes:''}),JSON.stringify(items),'synthetic-no-provider']);
 await f.request('/rest/v1/jobs',user.access,'POST',{id:job,workspace_id:user.workspace,title:canonical.job.title,description:canonical.job.description,criteria:[],knockouts:[],priority_draft_id:draft,created_by:user.id});
 await f.sql("update public.job_criteria_tasks set status='ready',result=jsonb_build_object('criteria','[]'::jsonb,'hiring_priorities',$2::jsonb,'model','synthetic-no-provider'),lease_id=null,lease_until=null where job_id=$1",[job,JSON.stringify(items)]);
 if(mixed){
  const {importMixed}=await import('./bulk-screening-mixed-browser.cjs');
  ({batch,rows,manifestCount}=await importMixed({f,user,report}));
  const draft=await snapshot(user,batch);assert.equal(draft.processed,0);assert.equal(draft.cost.provider_calls_reserved,0);assert.deepEqual(draft.batch.selected_ids,[]);
  await rpc(user,'update_screening_budget',{p_batch:batch,p_budget:10});
  await rpc(user,'start_resume_analysis',{p_batch:batch});
  report.scope='Actual browser app, PDF/DOCX/TXT/ZIP extraction and OCR into authenticated staging Storage and rules screening; 500 unique synthetic profiles, duplicate and failed-file recovery, then real selective Top 20 to Top 10. User confirmed recruiter accuracy validation separately.';
 }else{
 rows=Array.from({length:500},(_,i)=>({name:'Synthetic-'+i+'.txt',text:pool.candidates[i%5].text+'\nRecord '+i}));
 const manifest=rows.map(r=>({name:r.name,size:Buffer.byteLength(r.text)}));manifest.push({...manifest[0]});
 const start=performance.now();await rpc(user,'create_screening_batch',{p_id:batch,p_job:job,p_manifest:manifest,p_budget:5});
 report.batch_ack_ms=Math.round(performance.now()-start);const uploadStart=performance.now();
 for(let i=0;i<rows.length;i++){
  const row=rows[i],prepared=await rpc(user,'prepare_screening_upload',{p_batch:batch,p_ordinal:i,p_text:row.text});
  const path=`${user.workspace}/${job}/${prepared.candidate_id}/source-${prepared.hash}.txt`;
  await f.upload(user,path,Buffer.from(row.text),'text/plain');
  await f.request('/rest/v1/candidate_documents',user.access,'POST',{workspace_id:user.workspace,job_id:job,candidate_id:prepared.candidate_id,storage_path:path,file_name:row.name,mime_type:'text/plain',file_size:Buffer.byteLength(row.text),extracted_text:row.text,created_by:user.id});
  await rpc(user,'update_screening_item',{p_batch:batch,p_ordinal:i,p_status:'saved'});
  if([19,99,499].includes(i)){const started=performance.now(),value=await snapshot(user,batch);assert.equal(value.status,'provisional');report.runs.push({stage:'incremental',saved:i+1,ranked:value.processed,duration_ms:Math.round(performance.now()-started)});console.log('Bulk progress '+(i+1)+'/500, ranked '+value.processed);}
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 report.upload_ms=Math.round(performance.now()-uploadStart);
 const duplicate=await rpc(user,'prepare_screening_upload',{p_batch:batch,p_ordinal:500,p_text:rows[0].text});assert.equal(duplicate.stored,true);assert.equal(duplicate.duplicate,true);
 await rpc(user,'update_screening_item',{p_batch:batch,p_ordinal:500,p_status:'saved'});
 await rpc(user,'seal_screening_batch',{p_batch:batch});
 }
 let value;const rankingStart=performance.now();
 for(let page=0;page<8;page++){value=await snapshot(user,batch);if(value.status==='complete')break;}
 assert.equal(value.status,'complete');assert.equal(value.total,500);assert.equal(value.items.length,manifestCount);assert.equal(value.ranking.top.length,20);assert.equal(value.ranking.nearMiss.length,20);assert.equal(value.ai_calls_for_rules,0);
 report.runs.push({stage:'finish',ranked:value.processed,duration_ms:Math.round(performance.now()-rankingStart)});
 for(let run=0;run<3;run++){const started=performance.now(),warm=await snapshot(user,batch);assert.equal(warm.status,'complete');assert.deepEqual(warm.ranking.top.map(c=>c.candidateId),value.ranking.top.map(c=>c.candidateId));report.runs.push({stage:'warm',ranked:500,duration_ms:Math.round(performance.now()-started)});}
 for(const c of value.ranking.top){const i=Number(c.name.match(/Synthetic-(\d+)/)?.[1]);assert.equal(i%5,0,'Unsupported or keyword-only evidence entered Top 20');}
 const foreignRead=await f.request('/rest/v1/rpc/screening_batch_snapshot',foreign.access,'POST',{p_batch:batch},false);assert.ok(foreignRead.status>=400);
 const foreignWrite=await f.request('/rest/v1/rpc/select_screening_finalists',foreign.access,'POST',{p_batch:batch,p_ids:value.ranking.top.map(c=>c.candidateId),p_source:value.batch.source_version,p_version:0},false);assert.ok(foreignWrite.status>=400);
 const [counts]=await f.sql('select (select count(*) from public.ai_provider_usage where workspace_id=$1) as calls,(select count(*) from public.resume_intake_tasks where workspace_id=$1 and status in (\'queued\',\'processing\',\'ready\')) as paid_tasks,(select count(*) from public.candidates where workspace_id=$1) as candidates,(select count(*) from public.candidate_documents where workspace_id=$1) as documents',[user.workspace]);
 if(!mixed){assert.equal(Number(counts.calls),0);assert.equal(Number(counts.paid_tasks),0);}else assert.ok(Number(counts.paid_tasks)<=20);assert.equal(Number(counts.candidates),500);assert.equal(Number(counts.documents),500,'Lost upload responses duplicated stored documents');report.provider_calls=0;

 const foreignBudget=await f.request('/rest/v1/rpc/update_screening_budget',foreign.access,'POST',{p_batch:batch,p_budget:10},false);assert.ok(foreignBudget.status>=400);
 assert.equal(await rpc(user,'update_screening_budget',{p_batch:batch,p_budget:10}),10);
 const budgetOnly=await snapshot(user,batch,'status');assert.equal(budgetOnly.cost.budget_usd,10);if(!mixed)assert.equal(budgetOnly.cost.provider_calls_reserved,0);report.explicit_budget_update=true;
 const selected=value.ranking.top.map(c=>c.candidateId),deepStarted=performance.now();
 if(!mixed)await rpc(user,'select_screening_finalists',{p_batch:batch,p_ids:selected,p_source:value.batch.source_version,p_version:value.batch.selection_version});
 let deep;
 for(let poll=0;poll<300;poll++){
  deep=await snapshot(user,batch,'status');
  const failed=deep.selected.find(c=>c.assessment?.status==='failed');assert.ok(!failed,'Finalist assessment failed: '+failed?.assessment?.error);
  const [capacity]=await f.sql('select public.active_assessment_count($1) as active',[user.workspace]);assert.ok(Number(capacity.active)<=3,'Workspace capacity exceeded');
  if(deep.deep_status==='complete')break;
  if(poll%15===0)console.log('Deep progress '+deep.deep_completed+'/20');
  await new Promise(resolve=>setTimeout(resolve,2000));
 }
 assert.equal(deep.deep_status,'complete','Deep batch did not finish within ten minutes');assert.equal(deep.top10.length,10);assert.equal(deep.ranking.top.length,20);
 const [usage]=await f.sql('select count(*) as calls,sum(input_tokens) as input_tokens,sum(output_tokens) as output_tokens from public.ai_provider_usage where workspace_id=$1',[user.workspace]);
 assert.ok(Number(usage.calls)>=20&&Number(usage.calls)<=40);assert.ok(deep.cost.reserved_usd<=10);assert.equal(deep.cost.unsettled_calls,0);
 for(const candidate of deep.selected){
  const i=Number(candidate.name.match(/Synthetic-(\d+)/)?.[1]);assert.ok(candidate.assessment.result.resume_evidence.length>0);
  for(const evidence of candidate.assessment.result.resume_evidence)assert.ok(rows[i].text.includes(evidence.quote),'Unsupported provider quotation');
 }
 report.deep={duration_ms:Math.round(performance.now()-deepStarted),assessed:20,recommended:10,provider_calls:Number(usage.calls),input_tokens:Number(usage.input_tokens),output_tokens:Number(usage.output_tokens),...deep.cost};
 await rpc(user,'select_screening_finalists',{p_batch:batch,p_ids:selected,p_source:deep.batch.source_version,p_version:deep.batch.selection_version});
 const replay=await snapshot(user,batch,'status');assert.equal(replay.cost.provider_calls_reserved,deep.cost.provider_calls_reserved,'Replay reserved duplicate calls');assert.equal(replay.deep_status,'complete');
 const approved=deep.selected[0];await rpc(user,'review_resume_intake',{p_candidate:approved.candidateId,p_revision:approved.assessment.revision,p_decision:'approve'});
 const stored=(await f.request('/rest/v1/candidates?id=eq.'+approved.candidateId,user.access)).data[0];assert.equal(Number(stored.jd_score),approved.assessment.result.score);
 report.deep.approval_and_replay_passed=true;
 // Source invalidation is immediate even before the next worker tick.
 await f.sql('update public.jobs set manager_feedback=$2 where id=$1',[job,'Verify hands-on manual testing ownership.']);
 const stale=await snapshot(user,batch,'status');assert.equal(stale.status,'provisional');assert.equal(stale.processed,0);
 report.checks=[mixed?'500 candidates, 505 entries, two duplicates, three explicit exclusions':'500 candidates, 501 manifest entries, one duplicate','zero provider calls or paid intake tasks','incremental provisional results','warm stable Top 20 and near misses','workspace isolation','job-source invalidation','real Top 20 to Top 10 with exact source quotations','batch token/cost attribution and explicit approval','no duplicate AI on shortlist replay'];report.passed=true;
}catch(error){originalError=error;report.error=error.message;}
finally{
 try{await f.cleanup();await f.sql('update public.screening_feature_config set enabled=false');report.cleanup_passed=true;}catch(e){report.cleanup_passed=false;originalError??=e;}
 await mkdir('test-results/bulk-screening',{recursive:true});await writeFile('test-results/bulk-screening/staging.json',JSON.stringify(report,null,2));
}
console.log(JSON.stringify(report));
if(originalError)throw originalError;
