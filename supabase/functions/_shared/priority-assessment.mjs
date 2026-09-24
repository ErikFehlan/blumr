const obj=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const text=maxLength=>({type:'string',minLength:1,maxLength});
const isCandidate=s=>!['requirement','manager context','approved preference','approved learning'].includes(s.kind);
export const priorityAssessmentInstructions=`
When evaluation_context.hiring_priorities contains items, assess each in priority_assessment using its exact priority_id. These priorities are shared for this job, selected from the job description, and may be recruiter-reviewed; they are NOT confirmed manager preferences. Explicit criteria, knockout rules and actual manager context remain authoritative. Do not turn inferred or preferred priorities into mandatory requirements, invent numerical weights, or penalize a candidate merely because evidence is absent. Use them to focus the explanation and screening, without changing the rubric for different resumes. Report a concise evidence-based reason (max 25 words), candidate-specific source_ids and a focused question for each unknown, partial or contradicted finding. A supported finding may have an empty question. Missing evidence is unknown; cite [] when nothing establishes it. Requirements and shared preferences are never candidate evidence. Later specific manager feedback can change the candidate finding without rewriting these shared JD priorities. Never claim to know an unconsulted manager's preferences.`;
export function withPriorityAssessment(schema,priorities,sources){
 const items=priorities?.items||[];if(!items.length)return schema;
 const ids=sources.filter(isCandidate).map(s=>s.id);
 const finding=(status,min)=>obj({priority_id:{type:'string',enum:items.map(p=>p.id)},status:{type:'string',enum:status},reason:text(240),
  source_ids:{type:'array',minItems:min,maxItems:ids.length?8:0,items:ids.length?{type:'string',enum:[...new Set(ids)]}:text(120)},question:{type:'string',minLength:status.includes('supported')?0:1,maxLength:220}});
 return {...schema,required:[...schema.required,'priority_assessment'],properties:{...schema.properties,
  priority_assessment:{type:'array',minItems:items.length,maxItems:items.length,items:ids.length?{anyOf:[finding(['supported'],1),finding(['partial','contradicted'],1),finding(['unknown'],0)]}:finding(['unknown'],0)}}};
}
export function validatePriorityAssessment(result,priorities,sources){
 const items=priorities?.items||[];if(!items.length)return result;
 const fail=()=>{throw Object.assign(new Error('invalid_assessment_details'),{validationIssue:'priority_findings'});};
 const rows=result?.priority_assessment,candidateIds=new Set(sources.filter(isCandidate).map(s=>s.id));
 if(!Array.isArray(rows)||rows.length!==items.length||new Set(rows.map(r=>r?.priority_id)).size!==items.length)fail();
 for(const r of rows){
  if(!items.some(p=>p.id===r?.priority_id)||!['supported','partial','unknown','contradicted'].includes(r.status)||typeof r.reason!=='string'||!r.reason.trim()||r.reason.length>240)fail();
  if(!Array.isArray(r.source_ids)||r.source_ids.length>8||new Set(r.source_ids).size!==r.source_ids.length||r.source_ids.some(id=>!candidateIds.has(id))||(r.status!=='unknown'&&!r.source_ids.length))fail();
  if(typeof r.question!=='string'||r.question.length>220||(r.status!=='supported'&&!r.question.trim()))fail();
 }
 return {...result,hiring_priorities:priorities};
}
