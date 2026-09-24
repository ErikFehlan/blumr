import {handleCriteria} from '../supabase/functions/refine-job-criteria/handler.ts';
import {handleAnalysis} from '../supabase/functions/analyze-patterns-v2/analysis.ts';
const assert=(v:unknown,message:string)=>{if(!v)throw Error(message);};
const json=(v:unknown)=>new Response(JSON.stringify(v));
Deno.test('JD-only jobs generate grounded priorities through the private durable worker',async()=>{
 const names=['CRITERIA_WORKER_SECRET','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','OPENAI_API_KEY'],prior=names.map(n=>Deno.env.get(n)),original=globalThis.fetch;
 const description='Own manual regression testing. Automation experience is preferred.';
 let calls=0,finished:any,forged=false;
 try{
  ['worker','https://backend.invalid','service','ai'].forEach((v,i)=>Deno.env.set(names[i],v));
  globalThis.fetch=async(url,init)=>{
   calls++;const path=new URL(String(url)).pathname,body=JSON.parse(String(init?.body||'{}'));
   if(path.endsWith('/claim_job_criteria'))return json([{job_id:'j',workspace_id:'w',revision:'r',lease_id:'l',input:{title:'QA',description,criteria:[],manager_notes:'',knockouts:[]}}]);
   if(path.endsWith('/reserve_ai_budget'))return json({allowed:true});
   if(path==='/v1/responses'){
    const input=JSON.parse(body.input);assert(input.criteria.length===0&&input.job_description_sources.length>0,'JD-only work skipped');
    assert(body.text.format.schema.properties.hiring_priorities.maxItems===5,'unbounded priorities');
    return json({output:[{content:[{type:'output_text',text:JSON.stringify({criteria:[],hiring_priorities:[{title:'Manual regression ownership',reason:'This work is central to the role.',requirement_type:'inferred',question:'What testing did you personally own?',source_id:forged?'fake':input.job_description_sources[0].id}]})}]}]});
   }
   if(path.endsWith('/finish_job_criteria')){finished=body;return json(true);}
   throw Error('Unexpected request');
  };
  assert((await handleCriteria(new Request('https://worker.invalid',{method:'POST',body:'{}'}))).status===401&&calls===0,'public generation allowed');
  const request=()=>new Request('https://worker.invalid',{method:'POST',headers:{'x-worker-secret':'worker'},body:'{}'});
  assert((await handleCriteria(request())).ok&&finished.p_error===null,'generation failed');
  assert(finished.p_lease==='l'&&finished.p_revision==='r','revision protection lost');
  assert(description.includes(finished.p_result.hiring_priorities[0].source_quote),'source quotation changed');
  forged=true;await handleCriteria(request());assert(finished.p_error==='invalid_priorities'&&finished.p_result===null,'invented source saved');
 }finally{globalThis.fetch=original;names.forEach((n,i)=>prior[i]===undefined?Deno.env.delete(n):Deno.env.set(n,prior[i]!));}
});
Deno.test('intake evaluates saved priorities with candidate sources and returns their review basis',async()=>{
 const original=globalThis.fetch,prior=Deno.env.get('OPENAI_API_KEY');
 const priorities={basis:'job_description',review_status:'suggested',items:[{id:'priority-1',title:'Manual regression ownership',reason:'Core responsibility.',question:'What work did you own?',requirement_type:'inferred',source_quote:'Own manual regression testing.'}]};
 try{
  Deno.env.set('OPENAI_API_KEY','test-only');
  globalThis.fetch=async(_url,init)=>{
   const body=JSON.parse(String(init?.body));assert(body.text.format.schema.required.includes('priority_assessment'),'priority contract missing');
   const input=JSON.parse(body.input.slice(body.input.indexOf('{'))),source=input.resume_sources[0].id;
   assert(body.text.format.schema.properties.priority_assessment.items.anyOf[0].properties.source_ids.items.enum.includes(source),'resume evidence unavailable');
   return json({model:'synthetic',output_text:JSON.stringify({name:'Synthetic Candidate',role:'QA Analyst',score:7,manager_score:7,primary_signal:'Manual testing ownership.',jd_reason:'Manual testing supported.',manager_reason:'No manager context yet.',concerns:[],tags:[],screening_questions:[],resume_evidence:[{claim:'Manual testing ownership.',source_id:source}],criteria_assessment:[],feedback_impact:{effect:'initial',summary:'Initial resume evidence.',source_ids:[source]},applied_lessons:[],priority_assessment:[{priority_id:'priority-1',status:'supported',reason:'Resume describes personally owning regression testing.',source_ids:[source],question:''}]})});
  };
  const response=await handleAnalysis(new Request('https://analysis.invalid',{method:'POST',body:JSON.stringify({analysis_type:'resume',auto_intake:true,resume_text:'Synthetic Candidate. QA Analyst. Owned manual regression testing for billing systems and documented defects.',job:{title:'QA Analyst',description:'Own manual regression testing.',criteria:[]},evaluation_context:{sources:[],requirements:[],hiring_priorities:priorities}})}));
  const result=await response.json();assert(response.ok&&result.hiring_priorities.review_status==='suggested','priority provenance lost');assert(result.priority_assessment[0].status==='supported','finding missing');
 }finally{globalThis.fetch=original;prior===undefined?Deno.env.delete('OPENAI_API_KEY'):Deno.env.set('OPENAI_API_KEY',prior);}
});
