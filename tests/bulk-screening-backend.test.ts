import {processBulkScreeningBatch,summarizeBulkScreening,handleBulkScreening} from '../supabase/functions/_shared/bulk-screening.ts';
import {qualificationPools,qualificationJob} from './fixtures/screening-qualification-pools.mjs';
const assert=(v:unknown,message:string)=>{if(!v)throw Error(message);};
Deno.test('bulk pages reuse the shared evidence engine and stop on source changes',async()=>{
 const pool=qualificationPools[0],source={...qualificationJob(pool),workspaceId:'workspace',feedback:[],assessments:[],lessons:[],sourceVersion:'source'};
 let saved:any,writes=0;
 const rpc=async(name:string,body:any)=>{if(name==='bulk_screening_source')return source;if(name==='bulk_screening_page')return pool.candidates.map(c=>({candidate_id:c.id,document_id:c.id,resume_hash:'hash',resume_text:c.text}));if(name==='save_bulk_screening_page'){saved=body;writes++;return true;}throw Error('Unexpected paid operation '+name);};
 const result=await processBulkScreeningBatch('batch',rpc);assert(result.ai_calls===0&&writes===1,'Unexpected provider call');
 assert(saved.p_rows.every((r:any)=>r.resume_text===undefined),'Duplicate private text persisted');
 const rows=saved.p_rows.map((r:any)=>r.result);assert(rows[0].score>rows[2].score&&rows[1].score>rows[3].score,'Shared evidence interpretation changed');
 for(const r of saved.p_rows)for(const finding of r.result.findings)for(const e of finding.evidence)assert(pool.candidates.find(c=>c.id===r.candidate_id)!.text.includes(e.quote),'Invented evidence');
 let rejected=false;try{await processBulkScreeningBatch('batch',async(n,b)=>n==='save_bulk_screening_page'?false:rpc(n,b));}catch{rejected=true;}assert(rejected,'Stale source accepted');
});
Deno.test('unfinished imports, stale evidence, partial AI and duplicate files never imply a final Top 10',()=>{
 const candidates=Array.from({length:25},(_,i)=>({candidateId:String(i),name:'Synthetic '+i,result:{candidateId:String(i),rubricKey:'key',score:100-i,requiredStatus:'evidenced',findings:[]},assessment:i<20?{status:'ready',result:{score:10-i/10,manager_score:5+i/10}}:null}));
 const value:any={batch:{sealed:true,selected_ids:candidates.slice(0,20).map(c=>c.candidateId),intelligence:{coverage:{managerSources:[]}}},items:candidates.map(c=>({status:'saved',candidate_id:c.candidateId})),candidates,source_current:true,cost:{}};
 const full=summarizeBulkScreening(value);assert(full.status==='complete'&&full.deep_status==='complete'&&full.top10.length===10&&full.ranking.top.length===20,'Wrong shortlist sizes');assert(full.top10[0].candidateId==='0','JD-only job used invented manager preference');
 value.items.push({status:'pending'});assert(summarizeBulkScreening(value).deep_status==='provisional','Incomplete import shown final');value.items.pop();
 value.candidates[0].assessment.status='processing';assert(summarizeBulkScreening(value).deep_status==='provisional','Partial AI shown final');
 value.source_current=false;const stale=summarizeBulkScreening(value);assert(stale.processed===0&&stale.top10.length===0&&stale.status==='provisional','Stale scores presented as current');
});
Deno.test('bulk route verifies requested workspace before any privileged cache write',async()=>{
 const original=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;return Response.json({workspaceId:'foreign'});};
 try{const response=await handleBulkScreening({batch_id:'00000000-0000-0000-0000-000000000001',action:'refresh'},{workspace:'owned',base:'https://example.invalid',serviceKey:'secret',headers:{Authorization:'Bearer caller'}});assert(response.status===403&&requests===1,'Foreign batch crossed scope');}finally{globalThis.fetch=original;}
});
Deno.test('saved drafts perform no scoring or selection before Analyze; requested work continues on the worker',async()=>{
 const pool=qualificationPools[0],source:any={...qualificationJob(pool),workspaceId:'workspace',feedback:[],assessments:[],lessons:[],sourceVersion:'source',batch:{defer_analysis:true,analysis_requested_at:null,auto_selected:false}};
 const calls:string[]=[];
 const rpc=async(name:string)=>{calls.push(name);if(name==='bulk_screening_source')return source;if(name==='bulk_screening_page')return [];if(name==='save_bulk_screening_page')return true;if(name==='auto_start_resume_analysis')return true;throw Error(name);};
 const draft=await processBulkScreeningBatch('batch',rpc);assert(draft.status==='awaiting_start'&&calls.length===1,'Draft ran analysis');
 source.batch.analysis_requested_at='2026-10-27T14:00:00Z';calls.length=0;
 await processBulkScreeningBatch('batch',rpc);assert(calls.at(-1)==='auto_start_resume_analysis','Explicit request did not continue after scoring');
 source.batch.auto_selected=true;calls.length=0;
 await processBulkScreeningBatch('batch',rpc);assert(!calls.includes('auto_start_resume_analysis'),'Completed selection was replayed');
});
