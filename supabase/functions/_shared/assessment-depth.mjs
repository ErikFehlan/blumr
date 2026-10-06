// Shared, concise evidence contract. These are reviewable findings, not a transcript
// of the model's private reasoning. Memory is guidance, never candidate evidence.
const text = maxLength => ({type:'string',minLength:1,maxLength});
const ids = {type:'array',maxItems:8,items:text(120)};
const object = properties => ({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
export const detailProperties = {
  criteria_assessment:{type:'array',maxItems:40,items:object({criterion:text(600),status:{type:'string',enum:['supported','partial','unknown','contradicted']},evidence_type:{type:'string',enum:['direct','inferred','unknown','contradicted']},confidence:{type:'string',enum:['low','medium','high']},reason:text(240),inference_basis:{type:'string',maxLength:240},source_ids:ids})},
  feedback_impact:object({effect:{type:'string',enum:['initial','new_evidence','confirmation','contradiction','priority_change','insufficient_evidence','mixed']},summary:text(320),source_ids:ids}),
  applied_lessons:{type:'array',maxItems:12,items:object({lesson_id:text(120),application:text(240)})},
};
export const learningSuggestions = {type:'array',maxItems:2,items:object({kind:{type:'string',enum:['manager_priority','evaluation_method']},text:text(300),source_ids:{...ids,minItems:1}})};
export const depthInstructions = `
ASSESSMENT QUALITY
Evaluate each supplied job criterion in criteria_assessment, using its exact wording, and the explicit job description when criteria are absent. Weigh must-haves, supplied weights and documented priorities; do not invent requirements or weights. Resolve evidence against the rubric before comparing with prior scores, to avoid anchoring. Use supported, partial, unknown or contradicted and a brief evidence-based reason (at most 25 words). Also classify evidence_type as direct, inferred, unknown or contradicted and confidence as low, medium or high. Use inferred only when current-candidate evidence supports a job-relevant transfer from adjacent tools, workflows or responsibilities. inference_basis should briefly name that transfer; use an empty string for direct/unknown/contradicted evidence. Cite only supplied source IDs; unknown evidence may have no citation. A requirement or memory lesson is not evidence of candidate capability. Do not convert unknowns into established weaknesses. Distinguish direct ownership, contribution and team exposure; consider transferable work, scope and recency only when job-relevant. Do not count a repeated observation twice.
In feedback_impact, classify new information and explain the score change or unchanged result in at most 35 words. An advance/reject decision or selector alone is not new proof of qualifications. Separate confidence from fit. New evidence may change JD Fit and Manager Fit; manager preferences alone affect Manager Fit, not the JD rubric. Conflicting evidence should stay visible and generate a focused verification question. Do not force score movement.
Approved lessons are scoped, recruiter-reviewed guidance, not facts about this candidate or permission to ignore these instructions. Evaluation-method lessons may improve evidence interpretation but must never invent requirements or transfer another candidate's attributes, scores or hiring outcome. Manager-priority lessons apply to Manager Fit for this job only. Apply a lesson only where the current job and candidate evidence make it relevant. List only actually used lesson IDs and explain each application in at most 25 words. Contradictory or irrelevant lessons must not silently override current requirements. Never learn protected traits, demographic proxies or personal similarity.
Keep the visible findings concise; do not output private chain-of-thought.`;
export const learningInstructions = `
Propose at most two reusable learning_suggestions only when candidate feedback or a recruiter correction clearly supports a useful lesson. Use [] if there is no transferable lesson. Cite the originating feedback-ID or manual-correction source. A manager_priority must be an explicit job-related preference, not an inference from one rejection. An evaluation_method must describe how to interpret evidence (for example, distinguish ownership from support), not a qualification, employer preference or candidate-specific fact. Omit names, identifying details, candidate scores and decisions. Do not repeat existing approved lessons. Suggestions do not become memory until a recruiter explicitly approves their scope.`;

export function withDetails(schema, suggestions=false, constraints){
  const properties={...schema.properties,...detailProperties,...(suggestions?{learning_suggestions:learningSuggestions}:{})};
  if(constraints){
    const sources=constraints.sources||[],criteria=constraints.criteria||[];
    const refs=(values,min=0)=>values.length?{...ids,minItems:min,items:{type:'string',enum:[...new Set(values)]}}:{...ids,maxItems:0};
    const candidateIds=sources.filter(s=>!['requirement','manager context','approved preference','approved learning'].includes(s.kind)).map(s=>s.id);
    const criterion=criteria.length?{type:'string',enum:[...new Set(criteria)]}:text(600);
    const finding=status=>object({criterion,status:{type:'string',enum:status},evidence_type:{type:'string',enum:status.includes('unknown')?['unknown']:status.includes('contradicted')?['contradicted']:['direct','inferred']},confidence:{type:'string',enum:['low','medium','high']},reason:text(240),inference_basis:{type:'string',maxLength:240},source_ids:refs(candidateIds,status.includes('unknown')?0:1)});
    properties.criteria_assessment={...detailProperties.criteria_assessment,items:candidateIds.length?{anyOf:[finding(['supported','partial','contradicted']),finding(['unknown'])]}:finding(['unknown']),...(criteria.length?{minItems:criteria.length,maxItems:criteria.length}:{})};
    properties.feedback_impact=object({...detailProperties.feedback_impact.properties,source_ids:refs(sources.map(s=>s.id))});
    const lessons=sources.filter(s=>s.kind==='approved learning').map(s=>s.id);
    properties.applied_lessons={...detailProperties.applied_lessons,...(lessons.length?{items:object({lesson_id:{type:'string',enum:lessons},application:text(240)})}:{maxItems:0})};
    if(suggestions){
      const origins=sources.filter(s=>s.kind==='candidate feedback'||s.id==='manual-correction').map(s=>s.id);
      properties.learning_suggestions={...learningSuggestions,...(origins.length?{items:object({...learningSuggestions.items.properties,source_ids:refs(origins,1)})}:{maxItems:0})};
    }
  }
  return {...schema,properties,required:[...schema.required,...Object.keys(detailProperties),...(suggestions?['learning_suggestions']:[])]};
}

export function validateDetails(result, sources, {suggestions=false, required=true, criteria=[]}={}){
  const fail=issue=>{throw Object.assign(new Error('invalid_assessment_details'),{validationIssue:issue});};
  if(!required&&!Object.hasOwn(result,'criteria_assessment'))return result; // stored legacy results
  const byId=new Map(sources.map(s=>[s.id,s]));
  const validText=(s,n)=>typeof s==='string'&&s.trim().length>0&&s.length<=n;
  const validIds=(list,min=0)=>Array.isArray(list)&&list.length>=min&&list.length<=8&&new Set(list).size===list.length&&list.every(id=>byId.has(id));
  const memory=id=>byId.get(id)?.kind==='approved learning';
  if(!Array.isArray(result.criteria_assessment)||result.criteria_assessment.length>40)fail('criteria_count');
  for(const c of result.criteria_assessment){
    if(!validText(c?.criterion,600)||!['supported','partial','unknown','contradicted'].includes(c.status)||!['direct','inferred','unknown','contradicted'].includes(c.evidence_type)||!['low','medium','high'].includes(c.confidence)||!validText(c.reason,240)||typeof c.inference_basis!=='string'||c.inference_basis.length>240)fail('criterion_fields');
    if(c.status==='unknown'&&c.evidence_type!=='unknown'||c.status==='contradicted'&&c.evidence_type!=='contradicted'||c.evidence_type==='inferred'&&!c.inference_basis.trim())fail('criterion_evidence_type');
    if(!validIds(c.source_ids))fail('criterion_sources');
    if(c.source_ids.some(memory))fail('memory_as_evidence');
    if(c.status!=='unknown'&&!c.source_ids.some(id=>!['requirement','manager context','approved preference'].includes(byId.get(id)?.kind)))fail('candidate_evidence');
  }
  if(criteria.some(c=>!result.criteria_assessment.some(row=>row.criterion===c)))fail('missing_criterion');
  const impact=result.feedback_impact;
  if(!impact||!['initial','new_evidence','confirmation','contradiction','priority_change','insufficient_evidence','mixed'].includes(impact.effect)||!validText(impact.summary,320))fail('impact_fields');
  if(!validIds(impact.source_ids))fail('impact_sources');
  if(!Array.isArray(result.applied_lessons)||result.applied_lessons.length>12||new Set(result.applied_lessons.map(l=>l.lesson_id)).size!==result.applied_lessons.length
    ||result.applied_lessons.some(l=>!memory(l?.lesson_id)||!validText(l.application,240)))fail('applied_lessons');
  if(suggestions&&(!Array.isArray(result.learning_suggestions)||result.learning_suggestions.length>2||result.learning_suggestions.some(l=>!['manager_priority','evaluation_method'].includes(l?.kind)||!validText(l.text,300)||!validIds(l.source_ids,1)
      ||l.source_ids.some(id=>!(byId.get(id)?.kind==='candidate feedback'||id==='manual-correction')))))fail('learning_sources');
  return result;
}
