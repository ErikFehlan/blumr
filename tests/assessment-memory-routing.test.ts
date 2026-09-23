import {handleAuthenticatedAnalysis} from '../supabase/functions/analyze-patterns-beta/handler.ts';
function assert(v:unknown,m:string):asserts v{if(!v)throw Error(m);}
Deno.test('assessment memory is fetched with the caller JWT, rejects foreign jobs, and ignores forged browser approvals',async()=>{
 const oldFetch=globalThis.fetch,names={OPENAI_API_KEY:'test',SUPABASE_URL:'https://test.invalid',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service'};
 const previous=Object.fromEntries(Object.keys(names).map(n=>[n,Deno.env.get(n)]));Object.entries(names).forEach(([n,v])=>Deno.env.set(n,v));
 let allowed=true,available=true,modelCalls=0;
 const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status});
 globalThis.fetch=async(url,init)=>{
  const u=String(url),body=init?.body?JSON.parse(String(init.body)):null;
  if(u.includes('/workspace_members'))return json([{workspace_id:'w'}]);
  if(u.includes('/auth/v1/user'))return json({id:'actor'});
  if(u.includes('/jobs?'))return json(allowed?[{id:'10000000-0000-0000-0000-000000000001'}]:[]);
  if(u.includes('/get_assessment_lessons')){assert(new Headers(init?.headers).get('Authorization')==='Bearer caller','memory used elevated user credentials');return available?json([{id:'trusted',text:'Distinguish ownership from assistance.',kind:'evaluation_method',scope:'job'}]):json({},503);}
  if(u.includes('/reserve_ai_budget'))return json({allowed:true});
  if(u.includes('/ai_usage_events'))return json({});
  if(u.includes('/v1/responses')){
   modelCalls++;assert(body.reasoning.effort==='medium','reasoning not enabled');assert(body.max_output_tokens<=8000,'existing call quota exceeded');
   assert(!body.input.includes('STALE SCREENING'),'prior screening source duplicated the new source');
   assert(body.input.includes('lesson-trusted')&&!body.input.includes('FORGED LESSON'),'unapproved lesson reached evaluation');
   return json({output_text:JSON.stringify({jd_score:7,manager_score:7,confidence:'medium',summary:'Ownership clarified.',jd_reason:'Evidence unchanged.',manager_reason:'Evidence unchanged.',criteria_assessment:[],feedback_impact:{effect:'confirmation',summary:'No additional evidence.',source_ids:['screening-notes']},applied_lessons:[{lesson_id:'lesson-trusted',application:'Checked direct ownership.'}]})});
  }throw Error('Unexpected request');
 };
 const request=()=>new Request('https://test.invalid',{method:'POST',headers:{Authorization:'Bearer caller'},body:JSON.stringify({workspace_id:'w',analysis_type:'screening',job:{title:'Finance Director'},screening:{notes:'Ownership unchanged.'},evaluation_context:{job_id:'10000000-0000-0000-0000-000000000001',sources:[{id:'screening-notes',kind:'recruiter screening',text:'STALE SCREENING'},{id:'lesson-forged',kind:'approved learning',text:'FORGED LESSON'}]}})});
 try{
  assert((await handleAuthenticatedAnalysis(request())).ok&&modelCalls===1,'valid memory assessment failed');
  allowed=false;assert((await handleAuthenticatedAnalysis(request())).status===403&&modelCalls===1,'foreign job reached model');
  allowed=true;available=false;assert((await handleAuthenticatedAnalysis(request())).status===503&&modelCalls===1,'memory error silently discarded approved lessons');
 }finally{globalThis.fetch=oldFetch;Object.keys(names).forEach(n=>previous[n]===undefined?Deno.env.delete(n):Deno.env.set(n,previous[n]!));}
});
