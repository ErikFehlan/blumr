import {jobPassages, prioritiesSchema, priorityInstructions, validatePriorities} from './priorities.mjs';
import {untrustedInputInstructions} from '../_shared/untrusted-input.mjs';
import {analysisModel, modelReasoning} from '../_shared/model-routing.mjs';
import {fetchWithRetry} from '../_shared/provider-retry.ts';
export const priorityVersion='role-priorities-v3';
export type PriorityInput={title:string;description:string;manager_notes?:string};
export function priorityInput(value:any):PriorityInput {
  if(!value||typeof value.title!=='string'||!value.title.trim()||typeof value.description!=='string'||!value.description.trim())throw Error('invalid_priority_input');
  if(value.title.length>300||value.description.length>120000||String(value.manager_notes||'').length>12000)throw Error('input_too_large');
  return {title:value.title.trim(),description:value.description.trim(),manager_notes:String(value.manager_notes||'').trim()};
}
export async function generatePriorities(input:PriorityInput,options:{beforeModel:(bytes:number,tokens:number)=>Promise<void>;onUsage:(body:any)=>Promise<void>;requestId:string;retainAmbiguousFailures?:boolean}) {
  const passages=jobPassages(input),model=analysisModel('reassessment',name=>Deno.env.get(name));
  if(!passages.length)return {hiring_priorities:[],model:priorityVersion};
  const apiKey=Deno.env.get('OPENAI_API_KEY');if(!apiKey)throw Error('ai_unavailable');
  const data={job:{title:input.title},job_description_sources:passages,manager_context:input.manager_notes||''};
  const instructions=untrustedInputInstructions+priorityInstructions;
  await options.beforeModel(new TextEncoder().encode(JSON.stringify(data)+instructions).length,4000);
  let r:Response;
  try{r=await fetchWithRetry('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model,...modelReasoning(model,'reassessment'),store:false,max_output_tokens:4000,instructions,input:JSON.stringify(data),text:{format:{type:'json_schema',name:'job_priorities',strict:true,schema:{type:'object',additionalProperties:false,required:['hiring_priorities'],properties:{hiring_priorities:prioritiesSchema(passages)}}}}})},{timeoutMs:90000,maxRetries:2,requestId:options.requestId,retryTransport:!options.retainAmbiguousFailures});}
  catch{throw Error(options.retainAmbiguousFailures?'provider_outcome_uncertain':'ai_unavailable');}
  if(!r.ok){
    const failure=await r.json().catch(()=>null);
    if(['credit_balance_exhausted','project_spend_limit_exceeded','organization_spend_limit_exceeded','insufficient_quota'].includes(failure?.error?.code))throw Error('ai_budget_exhausted');
    if(options.retainAmbiguousFailures&&[408,504].includes(r.status))throw Error('provider_outcome_uncertain');
    throw Error(r.status===429?'ai_rate_limit':'ai_unavailable');
  }
  const body=await r.json();await options.onUsage(body);
  if(body.status==='incomplete')throw Error('invalid_priorities');
  const text=body.output_text||body.output?.flatMap((o:any)=>o.content||[]).filter((c:any)=>c.type==='output_text').map((c:any)=>c.text).join('');
  let parsed;try{parsed=JSON.parse(text||'{}');}catch{throw Error('invalid_priorities');}
  return {hiring_priorities:validatePriorities(parsed.hiring_priorities,passages),model};
}
