import {handleAuthenticatedAnalysis} from '../supabase/functions/analyze-patterns-beta/handler.ts';
const assert=(ok:unknown,message:string)=>{if(!ok)throw Error(message);};
const json=(body:unknown,status=200)=>Response.json(body,{status});
Deno.test('priority drafts authenticate, use full role context, preserve scope, cache and attach server quotes',async()=>{
 const keys=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','OPENAI_API_KEY'],old=keys.map(k=>Deno.env.get(k)),original=globalThis.fetch;
 keys.forEach((k,i)=>Deno.env.set(k,['https://backend.invalid','anon','service','ai'][i]));
 const job={title:'Azure Cloud Engineer',description:'Join a team of three engineers. Design Azure landing zones and hub-and-spoke networking. Help migrate on-premises services.',manager_notes:'A team role, not sole enterprise ownership.'};
 let saved:any=null,calls=0,member=true;
 globalThis.fetch=async(url:RequestInfo|URL,init?:RequestInit)=>{
  const path=new URL(String(url)).pathname,body=JSON.parse(String(init?.body||'{}'));
  if(path.endsWith('/workspace_members'))return json(member?[{workspace_id:'w'}]:[]);
  if(path.endsWith('/user'))return json({id:'verified'});
  if(path.endsWith('/hiring_priority_drafts')){
   if(init?.method==='POST'){saved=body;assert(body.actor_id==='verified'&&body.workspace_id==='w','forged caller used');return json([body]);}
   return json(saved?[saved]:[]);
  }
  if(path.endsWith('/claim_direct_ai_request'))return json({state:'owner'});
  if(path.endsWith('/mark_direct_ai_started')||path.endsWith('/finish_direct_ai_request'))return json(true);
  if(path.endsWith('/reserve_ai_budget'))return json({allowed:true});
  if(path==='/v1/responses'){
   calls++;const input=JSON.parse(body.input);
   assert(input.job.title===job.title&&input.manager_context===job.manager_notes,'role context lost');
   assert(input.job_description_sources.map((s:any)=>s.text).join('')===job.description,'whole JD not provided');
   assert(!input.candidates&&!input.evaluation_context,'candidate context leaked into priority generation');
   return json({output_text:JSON.stringify({hiring_priorities:[{title:'Design Azure landing zones and hub-and-spoke networking',reason:'Creates the foundation for the described cloud migration.',requirement_type:'inferred',source_id:input.job_description_sources[0].id,question:'What landing zones and network topology did you help implement?'}]})});
  }
  throw Error('Unexpected '+path);
 };
 const request=()=>new Request('https://handler.invalid',{method:'POST',headers:{Authorization:'Bearer caller'},body:JSON.stringify({workspace_id:'w',actor_id:'forged',analysis_type:'hiring_priorities',job})});
 try{
  const response=await handleAuthenticatedAnalysis(request()),out=await response.json();assert(response.ok&&out.draft_id&&out.items.length===1,'draft generation failed');
  assert(out.items[0].source_quote===job.description,'exact source lost');
  const again=await (await handleAuthenticatedAnalysis(request())).json();assert(calls===1&&again.draft_id===out.draft_id,'unchanged input generated again');
  member=false;assert((await handleAuthenticatedAnalysis(request())).status===403&&calls===1,'cache bypassed revoked access');
 }finally{globalThis.fetch=original;keys.forEach((k,i)=>old[i]===undefined?Deno.env.delete(k):Deno.env.set(k,old[i]!));}
});
