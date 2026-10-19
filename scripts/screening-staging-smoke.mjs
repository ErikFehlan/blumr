// Real authenticated staging requests; private synthetic TXT files with known
// extracted text and no paid model calls. No PDF/DOCX extraction is measured.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {fixtures} from './readiness-fixtures.mjs';
import {validateRuleSpec} from '../supabase/functions/_shared/screening-rule-spec.mjs';
import {rankScreeningCandidates} from '../supabase/functions/_shared/screening-engine.mjs';
const f=await fixtures();
if(process.argv[2]==='cleanup'){await f.cleanup();process.exit(0);}
const report={scope:'Authenticated staging, private synthetic TXT files. Ranking timings exclude fixture upload, document extraction, UI timing and real model quality.',runs:[],ai_calls:null,passed:false};
let state;
const call=(user,job,ids,extra={})=>f.request('/functions/v1/analyze-patterns-beta',user.access,'POST',{analysis_type:'rules_screening',workspace_id:user.workspace,job_id:job,candidate_ids:ids,...extra},false);
try{
 state=await f.create();const owner=state.users[0],foreign=state.users[1],job=randomUUID(),draft=randomUUID();
 const description='Implement Azure or AWS infrastructure. Maintain Terraform automation.';
 const items=[['Cloud infrastructure',['Azure','AWS'],['infrastructure']],['Terraform automation',['Terraform'],['automation']]].map(([title,...groups],i)=>{
  const p={id:'priority-'+(i+1),title,reason:'Deliver the described capability.',question:'What work did you personally perform?',source_quote:description,requirement_type:'inferred'};
  return {...p,screening_rule:validateRuleSpec({groups:groups.map(alternatives=>({alternatives})),unavailable_reason:''},p)};
 });
 // Seed a validated synthetic draft to exercise the real setup-to-job path
 // without buying priority generation for a benchmark.
 await f.sql('insert into public.hiring_priority_drafts(id,workspace_id,actor_id,fingerprint,input,items,model) values($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)',[draft,owner.workspace,owner.id,'a'.repeat(64),JSON.stringify({title:'Synthetic screening benchmark',description,manager_notes:''}),JSON.stringify(items),'synthetic-no-provider']);
 await f.request('/rest/v1/jobs',owner.access,'POST',{id:job,workspace_id:owner.workspace,title:'Synthetic screening benchmark',description,criteria:[],knockouts:[],priority_draft_id:draft,created_by:owner.id});
 // Ensure criteria completion cannot unexpectedly fan out after candidates exist.
 await f.sql("update public.job_criteria_tasks set status='ready',result=jsonb_build_object('criteria','[]'::jsonb,'hiring_priorities',$2::jsonb,'model','synthetic-no-provider'),lease_id=null,lease_until=null where job_id=$1 and workspace_id=$3",[job,JSON.stringify(items),owner.workspace]);
 const candidates=Array.from({length:1000},(_,i)=>({id:randomUUID(),workspace_id:owner.workspace,job_id:job,name:'Synthetic screening '+i,role:'Synthetic evidence fixture',created_by:owner.id}));
 for(let n=0;n<candidates.length;n+=100){
  const chunk=candidates.slice(n,n+100);await f.request('/rest/v1/candidates',owner.access,'POST',chunk);
  const docs=chunk.map((c,i)=>{const text=i%3?'Implemented Azure infrastructure. Maintained Terraform automation.':'Built AWS infrastructure. Skills: Terraform automation.';return {id:randomUUID(),workspace_id:owner.workspace,job_id:job,candidate_id:c.id,storage_path:`${owner.workspace}/${job}/${c.id}/${randomUUID()}.txt`,file_name:'Synthetic.txt',mime_type:'text/plain',file_size:Buffer.byteLength(text),extracted_text:text,created_by:owner.id};});
  // Preserve real document protections: metadata must match an owned private
  // Storage object. Bound upload concurrency and settle every write before cleanup.
  for(let offset=0;offset<docs.length;offset+=4){
   const writes=await Promise.allSettled(docs.slice(offset,offset+4).map(d=>f.upload(owner,d.storage_path,Buffer.from(d.extracted_text),'text/plain')));
   for(const write of writes)if(write.status==='rejected')throw write.reason;
  }
  await f.request('/rest/v1/candidate_documents',owner.access,'POST',docs);
 }
 // Fixtures never mark candidates "Resume awaiting analysis" and never queue
 // paid intake. Fail if any background assessment unexpectedly appears.
 const noPaidWork=async()=>{
  const [r]=await f.sql('select (select count(*) from public.ai_provider_usage where workspace_id=$1) as calls,(select count(*) from public.resume_intake_tasks where workspace_id=$1) as intakes,(select count(*) from public.job_reassessment_tasks where workspace_id=$1) as reassessments',[owner.workspace]);
  assert.equal(Number(r.calls),0);assert.equal(Number(r.intakes),0);assert.equal(Number(r.reassessments),0);return r;
 };
 await noPaidWork();
 for(const size of [20,100,500,1000]){
  const ids=candidates.slice(0,size).map(c=>c.id);
  // Clear only derived fixture caches to measure a cold run at each size.
  await f.sql('delete from public.candidate_screening_cache where workspace_id=$1',[owner.workspace]);
  for(let repeat=0;repeat<3;repeat++){
   const started=performance.now(),rows=[];let hits=0,first=null;
   for(let n=0;n<ids.length;n+=100){
    const r=await call(owner,job,ids.slice(n,n+100),{complete:true});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.status,'provisional');assert.equal(r.data.metrics.ai_calls,0);
    if(first===null)first=performance.now()-started;
    hits+=r.data.metrics.cache_hits;rows.push(...r.data.ranking.top,...r.data.ranking.nearMiss,...r.data.ranking.remaining);
   }
   assert.equal(rows.length,size);assert.equal(hits,repeat===0?0:size);
   const ranking=rankScreeningCandidates(rows,{complete:true});assert.equal(ranking.top.length,20);
   report.runs.push({candidates:size,path:repeat===0?'cold':'warm',duration_ms:Math.round((performance.now()-started)*100)/100,time_to_first_page_ms:Math.round(first*100)/100,cache_hits:hits,ai_calls:0});
  }
 }
 // Foreign workspace and forged client sources cannot access or alter results.
 assert.equal((await call(foreign,job,[candidates[0].id])).status,403);
 const edited=await call(owner,job,[candidates[0].id],{resume_text:'Invented perfect candidate',job:{description:'Forged'},priorities:[],complete:true});assert.equal(edited.data.metrics.cache_hits,1);assert.equal(edited.data.status,'provisional');
 const [doc]=await f.sql('select id from public.candidate_documents where candidate_id=$1',[candidates[0].id]);
 await f.request('/rest/v1/candidate_documents?id=eq.'+doc.id,owner.access,'PATCH',{extracted_text:'No Azure, AWS, Terraform or infrastructure experience is claimed.'});
 const changed=await call(owner,job,[candidates[0].id]);assert.equal(changed.data.metrics.cache_hits,0);assert.equal(changed.data.ranking.top[0].score,0);
 const usage=await noPaidWork();report.ai_calls=Number(usage.calls);report.passed=true;
}finally{
 try{await f.cleanup();report.cleanup='passed';}catch(error){report.cleanup='failed';report.passed=false;throw error;}
 finally{await mkdir('test-results/screening',{recursive:true});await writeFile('test-results/screening/staging.json',JSON.stringify(report,null,2));}
}
console.log(JSON.stringify(report,null,2));
