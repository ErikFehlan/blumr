import {buildScreeningRubric,fingerprint,screeningVersion} from './screening-engine.mjs';
import {relationships,workflowRelationships} from './transferability.mjs';
import {ruleSpecVersion,validateRuleSpec} from './screening-rule-spec.mjs';
import {vocabularyVersion,equivalentCapabilities,titleFamilies,credentialFamilies,equivalentTitles,capabilityWorkflows} from './screening-vocabulary.mjs';
import {compileJobRequirements,requirementsVersion,approvedManagerSources} from './screening-requirements.mjs';
export const jobIntelligenceVersion='job-intelligence-v3';

// A single source-bound rubric for the job. No candidate content or provider is
// involved. Ordinary legacy priorities and recruiter edits compile automatically.
/** @param {{workspaceId:string,job:any,priorities:any,feedbackVersion?:string,feedback?:any[],assessments?:any[],lessons?:any[],asOf?:string}} input */
export async function buildJobIntelligence({workspaceId,job,priorities,feedbackVersion='',feedback=[],assessments=[],lessons=[],asOf}){
 if(!workspaceId||!job?.id||job.workspace_id!==workspaceId)throw Error('invalid_screening_scope');
 const day=new Date(asOf||Date.now()).toISOString().slice(0,10),issues=[];
 const manager=approvedManagerSources({feedback,assessments,lessons,job});
 const source={version:jobIntelligenceVersion,engineVersion:screeningVersion,ruleSpecVersion,requirementsVersion,vocabularyVersion,relationships,workflowRelationships,equivalentCapabilities,titleFamilies,credentialFamilies,capabilityWorkflows,workspaceId,jobId:job.id,title:job.title,description:job.description||'',criteria:job.criteria||[],knockouts:job.knockouts||[],managerContext:job.manager_feedback||'',priorities,feedbackVersion,managerSources:manager.sources,asOf:day};
 const key=await fingerprint(source);
 if(priorities?.source_title!==job.title||priorities?.source_description!==(job.description||''))issues.push({code:'stale_priorities'});
 if(!priorities?.items?.length)issues.push({code:'missing_priorities'});
 if(issues.length)return {version:jobIntelligenceVersion,key,status:'needs_review',issues,weights:[],weightPolicy:'priority_order_with_explicit_manager_emphasis_v1',rubric:null,aiCalls:0};
 const items=priorities.items.map(p=>{
  if(!p.screening_rule)return p;
  if(p.screening_rule.bound_title!==p.title||p.screening_rule.bound_reason!==p.reason||p.screening_rule.bound_question!==p.question)return {...p,source_kind:'recruiter',screening_rule:null};
  // A stale or invalid generated hint cannot supply new qualifications. The
  // canonical source is still sufficient for deterministic recompilation.
  try{return {...p,screening_rule:validateRuleSpec(p.screening_rule,p)};}
  catch{return {...p,screening_rule:null};}
 });
 const compiled=compileJobRequirements({job,priorities:{...priorities,items},managerSources:manager.sources});
 issues.push(...compiled.issues,...manager.ignored.map(i=>({code:i.reason,sourceId:i.sourceId})));
 const primaryIds=new Set(items.map(p=>p.id)),primary=compiled.rules.filter(r=>primaryIds.has(r.id));
 const weights=compiled.rules.map(r=>({priorityId:r.id,weight:r.weight,share:r.weight/compiled.rules.reduce((n,v)=>n+v.weight,0),origin:r.origin}));
 const blocked=compiled.issues.length>0||!primary.length;
 if(blocked)return {version:jobIntelligenceVersion,key,status:'needs_review',issues:issues.length?issues:[{code:'no_job_related_priorities'}],weights,weightPolicy:'priority_order_with_explicit_manager_emphasis_v1',rubric:null,aiCalls:0};
 const canonical=primary.map(r=>({...items.find(p=>p.id===r.id),source_quote:r.sourceQuote,requirement_type:r.requirementType}));
 const rubric=await buildScreeningRubric({workspaceId,jobId:job.id,jobVersion:key,feedbackVersion,asOf:day,
  priorities:canonical,rules:primary.map(r=>({priorityId:r.id,weight:r.weight,condition:r.condition})),
  additionalRequirements:compiled.rules.filter(r=>!primaryIds.has(r.id)),titleTerms:equivalentTitles(job.title)});
 return {version:jobIntelligenceVersion,key,status:'ready',issues,weights,weightPolicy:'priority_order_with_explicit_manager_emphasis_v1',rubric,aiCalls:0,
  asOf:day,coverage:{priorities:primary.length,additionalRequirements:compiled.rules.length-primary.length,excluded:compiled.excluded,managerAdjustments:compiled.adjustments,managerSources:manager.sources.map(({id,kind,quote})=>({id,kind,quote}))},
  seniority:{title:job.title,explicitRequirements:compiled.rules.filter(r=>/senior|lead|supervis|independent|ownership|manage/i.test(r.title)).map(r=>r.id),note:'Titles are relevance context, not proof of seniority, years, management or qualification.'}};
}
