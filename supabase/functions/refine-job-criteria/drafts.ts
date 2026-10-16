import {fingerprint,withDirectIdempotency} from '../_shared/direct-idempotency.ts';
import {reserveModelCall,recordProviderUsage,SecurityLimit,securityMessage} from '../_shared/security.ts';
import {priorityInput,priorityVersion,generatePriorities} from './generate.ts';
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Access-Control-Allow-Origin':'*'}});
// Called only after real-user authentication and workspace membership checks.
export async function handlePriorityDraft(raw:unknown,scope:{workspace:string;actor:string;base:string;serviceKey:string}) {
  let input;try{input=priorityInput(raw);}catch(error){return json({code:(error as Error).message,error:'Add a job title and a readable job description before preparing priorities.'},400);}
  const key=await fingerprint({version:priorityVersion,input}),headers={Authorization:'Bearer '+scope.serviceKey,apikey:scope.serviceKey,'Content-Type':'application/json'};
  const query=`workspace_id=eq.${encodeURIComponent(scope.workspace)}&actor_id=eq.${encodeURIComponent(scope.actor)}&fingerprint=eq.${key}`;
  const format=(row:any)=>({draft_id:row.id,input:row.input,items:row.items,model:row.model});
  try{
    const cached=await fetch(`${scope.base}/rest/v1/hiring_priority_drafts?select=id,input,items,model&${query}`,{headers,signal:AbortSignal.timeout(10000)});
    if(!cached.ok)return json({error:'Priorities could not be loaded. Try again shortly.'},503);
    const rows=await cached.json();if(rows.length)return json(format(rows[0]));
  }catch{return json({error:'Priorities could not be loaded. Try again shortly.'},503);}
  return withDirectIdempotency({...scope,payload:{version:priorityVersion,input},execute:async(claim,markStarted)=>{
    try{
      const result=await generatePriorities(input,{requestId:`priorities-${claim}`,retainAmbiguousFailures:true,beforeModel:async(bytes,tokens)=>{await markStarted();await reserveModelCall(scope.workspace,scope.actor,bytes,tokens);},onUsage:body=>recordProviderUsage(scope.workspace,'hiring_priorities',body,scope.actor)});
      const row={id:claim,workspace_id:scope.workspace,actor_id:scope.actor,fingerprint:key,input,items:result.hiring_priorities,model:result.model};
      const saved=await fetch(`${scope.base}/rest/v1/hiring_priority_drafts?on_conflict=workspace_id,actor_id,fingerprint`,{method:'POST',headers:{...headers,Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify(row),signal:AbortSignal.timeout(10000)});
      if(!saved.ok)throw Error('priority_save_failed');
      const persisted=await saved.json();if(!persisted.length)throw Error('priority_save_failed');
      return json(format(persisted[0]));
    }catch(error){
      const code=error instanceof Error?error.message:'ai_unavailable';
      const message=error instanceof SecurityLimit?securityMessage(error.code):code==='ai_budget_exhausted'?'Priority analysis is paused until AI credits are available. Your job details are still here.':'Priorities could not be prepared. Your job details are still here; try again shortly.';
      return json({code,error:message},error instanceof SecurityLimit?error.status:503);
    }
  }});
}
