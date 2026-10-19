import {buildScreeningRubric,fingerprint,screeningVersion} from './screening-engine.mjs';
import {relationships,workflowRelationships} from './transferability.mjs';
import {normalizeTerm,ruleSpecVersion,validateRuleSpec} from './screening-rule-spec.mjs';
export const jobIntelligenceVersion='job-intelligence-v2';
// True spelling/name equivalents only. Adjacent technologies stay inferred.
const equivalents=[['ci/cd','continuous integration and continuous delivery'],['infrastructure as code','iac'],['general ledger','gl'],['accounts payable','a/p'],['accounts receivable','a/r'],['standard operating procedures','sops'],['google cloud','gcp'],['secure sdlc','ssdlc','secure software development lifecycle']];
function conditionFor(spec){
 return {all:spec.groups.map(group=>({any:group.alternatives.map(term=>{
  const direct=equivalents.find(names=>names.includes(term))||[term];
  const related=[...relationships,...workflowRelationships].filter(r=>direct.includes(r.target)).flatMap(r=>r.related);
  return {terms:direct,related:[...new Set(related)].filter(t=>!direct.includes(t))};
 })}))};
}
// This compiles existing server-owned priorities. It never calls a provider,
// rewrites a priority, guesses missing rules, or accepts client-supplied criteria.
export async function buildJobIntelligence({workspaceId,job,priorities,feedbackVersion=''}){
 if(!workspaceId||!job?.id||job.workspace_id!==workspaceId)throw Error('invalid_screening_scope');
 const items=priorities?.items||[];
 const source={version:jobIntelligenceVersion,engineVersion:screeningVersion,ruleSpecVersion,relationships,workflowRelationships,equivalents,workspaceId,jobId:job.id,title:job.title,description:job.description||'',criteria:job.criteria||[],knockouts:job.knockouts||[],managerContext:job.manager_feedback||'',priorities,feedbackVersion};
 const key=await fingerprint(source),issues=[];
 if(priorities?.source_title!==job.title||priorities?.source_description!==(job.description||''))issues.push({code:'stale_priorities'});
 if(!items.length)issues.push({code:'missing_priorities'});
 const rules=[];
 for(const [index,p] of items.entries()){
  const spec=p.screening_rule;
  if(p.source_kind==='recruiter'||!p.source_quote||!String(job.description||'').includes(p.source_quote)){issues.push({priorityId:p.id,code:'priority_needs_rule_review'});continue;}
  if(!spec||spec.version!==ruleSpecVersion){issues.push({priorityId:p.id,code:'missing_rule'});continue;}
  if(spec.bound_title!==p.title||spec.bound_reason!==p.reason||spec.bound_question!==p.question){issues.push({priorityId:p.id,code:'edited_priority_needs_rule_review'});continue;}
  try{
   const checked=validateRuleSpec(spec,p);
   if(!checked.groups.length){issues.push({priorityId:p.id,code:'complex_priority_needs_review'});continue;}
   // The ranking of canonical priorities supplies an explicit product default.
   // This is NOT a model-invented or hiring-manager-confirmed numerical weight.
   rules.push({priorityId:p.id,weight:items.length-index,condition:conditionFor(checked)});
  }catch{issues.push({priorityId:p.id,code:'invalid_rule'});}
 }
 // Explicit criteria/knockouts can add qualifications not represented by priorities.
 // Do not quietly publish a complete ranking that ignores these constraints.
 const uncovered=[...(job.criteria||[]),...(job.knockouts||[])].filter(c=>typeof c!=='string'||!items.some(p=>normalizeTerm(p.title)===normalizeTerm(c)));
 if(uncovered.length)issues.push({code:'additional_requirements_need_review',count:uncovered.length});
 if(job.manager_feedback?.trim())issues.push({code:'manager_context_needs_rule_review'});
 const weights=rules.map(r=>({priorityId:r.priorityId,weight:r.weight,share:r.weight/rules.reduce((n,v)=>n+v.weight,0)}));
 if(issues.length)return {version:jobIntelligenceVersion,key,status:'needs_review',issues,weights,weightPolicy:'priority_order_v1',rubric:null,aiCalls:0};
 const rubric=await buildScreeningRubric({workspaceId,jobId:job.id,jobVersion:key,feedbackVersion,priorities:items,rules});
 return {version:jobIntelligenceVersion,key,status:'ready',issues:[],weights,weightPolicy:'priority_order_v1',rubric,aiCalls:0};
}
