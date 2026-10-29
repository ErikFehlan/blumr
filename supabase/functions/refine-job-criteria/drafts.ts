import {fingerprint,withDirectIdempotency} from '../_shared/direct-idempotency.ts';
import {reserveModelCall,recordProviderUsage,SecurityLimit,securityMessage} from '../_shared/security.ts';
import {priorityInput,priorityGenerationVersion,generatePriorities} from './generate.ts';
import {subscriptionEntitlement,SubscriptionError} from '../_shared/subscriptions.ts';
import {rulesOnlyPriorities,rulesOnlyPriorityVersion} from './rules-only.mjs';
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Access-Control-Allow-Origin':'*'}});
// Called only after real-user authentication and workspace membership checks.
export async function handlePriorityDraft(raw:unknown,scope:{workspace:string;actor:string;base:string;serviceKey:string}) {
  let input;try{input=priorityInput(raw);}catch(error){return json({code:(error as Error).message,error:'Add a job title and a readable job description before preparing priorities.'},400);}
  let entitlement;
  try{entitlement=await subscriptionEntitlement(scope.workspace,scope.actor);}
  catch(error){const failure=error as SubscriptionError;return json({code:failure.code,error:securityMessage(failure.code)},failure.status||503);}
  const rulesOnly=entitlement?.tier==='basic';
  const priorityVersion=rulesOnly?rulesOnlyPriorityVersion:priorityGenerationVersion();
  const key=await fingerprint({version:priorityVersion,input}),headers={Authorization:'Bearer '+scope.serviceKey,apikey:scope.serviceKey,'Content-Type':'application/json'};
  const query=`workspace_id=eq.${encodeURIComponent(scope.workspace)}&actor_id=eq.${encodeURIComponent(scope.actor)}&fingerprint=eq.${key}`;
  const format=(row:any)=>({draft_id:row.id,input:row.input,items:row.items,model:row.model,...(rulesOnly?{review_required:true,engine:'rules_only'}:{})});
  try{
    const cached=await fetch(`${scope.base}/rest/v1/hiring_priority_drafts?select=id,input,items,model&${query}`,{headers,signal:AbortSignal.timeout(10000)});
    if(!cached.ok)return json({error:'Priorities could not be loaded. Try again shortly.'},503);
    const rows=await cached.json();if(rows.length)return json(format(rows[0]));
  }catch{return json({error:'Priorities could not be loaded. Try again shortly.'},503);}
  const execute=async(claim:string,markStarted:()=>Promise<void>)=>{
    try{
      const result=rulesOnly?rulesOnlyPriorities(input):await generatePriorities(input,{requestId:`priorities-${claim}`,retainAmbiguousFailures:true,beforeModel:async(bytes,tokens)=>{await reserveModelCall(scope.workspace,scope.actor,bytes,tokens,{operation:'job_setup'});await markStarted();},onUsage:body=>recordProviderUsage(scope.workspace,'criteria_refinement',body,scope.actor)});
      const row={id:claim,workspace_id:scope.workspace,actor_id:scope.actor,fingerprint:key,input,items:result.hiring_priorities,model:result.model};
      const saved=await fetch(`${scope.base}/rest/v1/hiring_priority_drafts?on_conflict=workspace_id,actor_id,fingerprint`,{method:'POST',headers:{...headers,Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify(row),signal:AbortSignal.timeout(10000)});
      if(!saved.ok)throw Error('priority_save_failed');
      let persisted=await saved.json();
      // Another deterministic request may win the unique fingerprint insert.
      if(!persisted.length&&rulesOnly){
        const winner=await fetch(`${scope.base}/rest/v1/hiring_priority_drafts?select=id,input,items,model&${query}`,{headers,signal:AbortSignal.timeout(10000)});
        if(winner.ok)persisted=await winner.json();
      }
      if(!persisted.length)throw Error('priority_save_failed');
      return json(format(persisted[0]));
    }catch(error){
      const code=error instanceof Error?error.message:'ai_unavailable';
      const message=error instanceof SecurityLimit?securityMessage(error.code):code==='ai_budget_exhausted'?'Priority analysis is paused until AI credits are available. Your job details are still here.':'Priorities could not be prepared. Your job details are still here; try again shortly.';
      return json({code,error:message},error instanceof SecurityLimit?error.status:503);
    }
  };
  // Provider-free work does not create an AI request/lease or require an API key.
  if(rulesOnly)return execute(crypto.randomUUID(),async()=>{});
  return withDirectIdempotency({...scope,payload:{version:priorityVersion,input},execute});
}
