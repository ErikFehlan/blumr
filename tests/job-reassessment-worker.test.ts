import {handleReassessment} from '../supabase/functions/reassess-job/handler.ts';
function assert(condition:unknown,message='Assertion failed'){if(!condition)throw Error(message);}
Deno.test('reassessment worker resolves evidence selections and keeps unsupported findings rejected',async()=>{
 const names=['JOB_REASSESSMENT_SECRET','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','OPENAI_API_KEY'],previous=names.map(n=>Deno.env.get(n));
 const fetchBefore=globalThis.fetch,timerBefore=globalThis.setTimeout;
 const task={workspace_id:'workspace-a',candidate_id:'c',revision:'r',lease_id:'lease',input:{job:{id:'j',title:'QA',description:'Manual testing required.',criteria:['-manual testing required']},candidate:{id:'c',jobId:'j',jdScore:7,managerScore:7,strengths:['Owned manual testing but did not write automation.']},feedback:[],outcomes:[]}};
 let forged=false,finished:any;
 try{
  for(const [i,value] of ['worker','https://backend.invalid','service','ai'].entries())Deno.env.set(names[i],value);
  globalThis.setTimeout=((fn:()=>void,ms:number)=>timerBefore(fn,ms===3500?0:ms)) as typeof setTimeout;
  globalThis.fetch=async(url,init)=>{
   const path=new URL(String(url)).pathname,body=JSON.parse(String(init?.body||'{}')),json=(x:unknown)=>new Response(JSON.stringify(x));
   if(path.endsWith('/claim_account_deletions')||path.endsWith('/claim_resume_intakes'))return json([]);
   if(path.endsWith('/claim_job_reassessments'))return json([task]);
   if(path.endsWith('/reserve_ai_budget'))return json({allowed:true});
   if(path==='/v1/responses'){
    const format=body.text.format.schema,support=format.properties.evidence_support.items.properties;
    assert(!support.quote&&!support.source_id&&support.passage_id.enum.length,'model can write quotations');
    const context=JSON.parse(body.input).evaluation_context,source=context.sources.find((s:any)=>s.id==='profile-strength-1');
    const result={jd_score:7,manager_score:7,confidence:'medium',summary:'Manual ownership supported.',jd_reason:'Manual testing supported.',manager_reason:'No new priority.',questions:[],
     evidence_support:[{passage_id:source.passages[0].id,claim:'Manual ownership without automation authorship.'}],criteria_assessment:[{criterion:'-manual testing required',status:'supported',reason:'Manual ownership is explicit.',source_ids:forged?['criterion-1']:['profile-strength-1']}],
     feedback_impact:{effect:'confirmation',summary:'No new evidence changes the baseline.',source_ids:['profile-strength-1']},applied_lessons:[],learning_suggestions:[]};
    return json({model:'gpt-5.6-sol',output:[{content:[{type:'output_text',text:JSON.stringify(result)}]}]});
   }
   if(path.endsWith('/finish_job_reassessment')){finished=body;return json(true);}
   if(path.endsWith('/continue_job_reassessments'))return json(null);
   throw Error('Unexpected request');
  };
  const request=()=>new Request('https://worker.invalid',{method:'POST',headers:{'x-worker-secret':'worker'},body:'{}'});
  assert((await handleReassessment(request())).ok&&finished.p_error===null,'valid assessment did not finish');
  assert(finished.p_lease==='lease'&&finished.p_revision==='r','lease or revision lost');
  assert(finished.p_result.evidence_support[0].quote===task.input.candidate.strengths[0],'exact quotation or negation changed');
  assert(finished.p_result.evidence_ids[0]==='profile-strength-1','source identity lost');
  forged=true;await handleReassessment(request());
  assert(finished.p_result===null&&finished.p_error==='validation_candidate_evidence','requirements used as candidate evidence');
 }finally{globalThis.fetch=fetchBefore;globalThis.setTimeout=timerBefore;names.forEach((n,i)=>previous[i]===undefined?Deno.env.delete(n):Deno.env.set(n,previous[i]!));}
});
Deno.test('reassessment endpoint requires its private credential before configuration or work is exposed',async()=>{
 const names=['JOB_REASSESSMENT_SECRET','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','OPENAI_API_KEY'];
 const previous=Object.fromEntries(names.map(name=>[name,Deno.env.get(name)]));
 try{
  Deno.env.set('JOB_REASSESSMENT_SECRET','private-worker-test');Deno.env.set('SUPABASE_URL','https://unused.invalid');Deno.env.set('SUPABASE_SERVICE_ROLE_KEY','private-service-test');Deno.env.set('OPENAI_API_KEY','private-ai-test');
  const unauthorized=await handleReassessment(new Request('https://worker.invalid',{method:'POST',body:'{"health":true}'}));assert(unauthorized.status===401);
  const health=await handleReassessment(new Request('https://worker.invalid',{method:'POST',headers:{'x-worker-secret':'private-worker-test'},body:'{"health":true}'}));
  assert(health.status===200);const text=await health.text();assert(text.includes('job_reassessment'));assert(!text.includes('private-'));
  const invalid=await handleReassessment(new Request('https://worker.invalid',{method:'POST',headers:{'x-worker-secret':'private-worker-test'},body:'{"job_id":"not-a-job"}'}));assert(invalid.status===400);
  const malformed=await handleReassessment(new Request('https://worker.invalid',{method:'POST',headers:{'x-worker-secret':'private-worker-test'},body:'null'}));assert(malformed.status===400);
 }finally{for(const name of names){if(previous[name]===undefined)Deno.env.delete(name);else Deno.env.set(name,previous[name]!);}}
});

Deno.test('saved resumes start while job edits are still coalescing and retain their lease',async()=>{
 const names=['JOB_REASSESSMENT_SECRET','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','OPENAI_API_KEY'];
 const previous=Object.fromEntries(names.map(name=>[name,Deno.env.get(name)]));
 const originalFetch=globalThis.fetch,originalTimer=globalThis.setTimeout;
 let releaseDelay:()=>void=()=>{},markStarted:()=>void=()=>{},markDelayed:()=>void=()=>{},timer:ReturnType<typeof setTimeout>|undefined;
 const started=new Promise<void>(resolve=>markStarted=resolve),delayed=new Promise<void>(resolve=>markDelayed=resolve);
 let finished=false,jobClaimed=false,run:Promise<Response>|undefined;
 const task={workspace_id:'workspace-a',candidate_id:'c',revision:'revision-1',lease_id:'lease-1',input:{job:{id:'j',title:'Synthetic QA',criteria:[],weights:[],knockouts:[]},candidate:{id:'c',jobId:'j'},feedback:[],outcomes:[],resume_text:'Synthetic QA Analyst. Owned manual regression testing and documented defects.',file_name:'Synthetic.txt'}};
 try{
  for(const [name,value] of Object.entries({JOB_REASSESSMENT_SECRET:'test-worker',SUPABASE_URL:'https://backend.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-service',OPENAI_API_KEY:'test-ai'}))Deno.env.set(name,value);
  globalThis.setTimeout=((callback:()=>void,ms:number)=>{
   if(ms===3500){releaseDelay=()=>callback();markDelayed();return 0;}
   return originalTimer(callback,ms);
  }) as typeof setTimeout;
  globalThis.fetch=async(url,init)=>{
   const path=new URL(String(url)).pathname;
   const json=(data:unknown)=>new Response(JSON.stringify(data));
   if(path.endsWith('/reserve_ai_budget'))return json({allowed:true});
   if(path.endsWith('/claim_account_deletions'))return json([]);
   if(path.endsWith('/claim_resume_intakes'))return json([task]);
   if(path==='/v1/responses'){
    markStarted();
    return json({output_text:JSON.stringify({criteria_assessment:[],feedback_impact:{effect:'confirmation',summary:'No additional qualification evidence.',source_ids:[]},applied_lessons:[],name:'Synthetic QA Analyst',role:'QA Analyst',score:7,manager_score:7,primary_signal:'Testing ownership',jd_reason:'Testing evidence',manager_reason:'Ownership evidence',concerns:[],tags:['QA'],screening_questions:[],resume_evidence:[{claim:'Manual regression ownership',source_id:'resume-1'}]})});
   }
   if(path.endsWith('/finish_resume_intake')){const body=JSON.parse(String(init?.body));assert(body.p_lease==='lease-1'&&body.p_revision==='revision-1','Lease or revision changed');assert(body.p_error===null&&body.p_result.resume_evidence[0].quote===task.input.resume_text,'Grounded completion missing');finished=true;return json(true);}
   if(path.endsWith('/claim_job_reassessments')){jobClaimed=true;return json([]);}
   throw Error('Unexpected test request');
  };
  run=handleReassessment(new Request('https://worker.invalid',{method:'POST',headers:{'x-worker-secret':'test-worker'},body:'{}'}));
  await delayed;
  const immediate=await Promise.race([started.then(()=>true),new Promise<boolean>(resolve=>timer=originalTimer(()=>resolve(false),100))]);
  if(timer!==undefined)clearTimeout(timer);
  assert(immediate,'Resume model waited for the job debounce');assert(!jobClaimed,'Job debounce was removed');
  releaseDelay();const response=await run;assert(response.ok&&finished,'Intake was not completed durably');
 }finally{
  releaseDelay();if(run)await run;globalThis.fetch=originalFetch;globalThis.setTimeout=originalTimer;
  if(timer!==undefined)clearTimeout(timer);
  for(const name of names){if(previous[name]===undefined)Deno.env.delete(name);else Deno.env.set(name,previous[name]!);}
 }
});
