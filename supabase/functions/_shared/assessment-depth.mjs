import {candidateEvidence,transferabilityHints} from './transferability.mjs';
import {resumeSources} from '../analyze-patterns-v2/resume-sources.mjs';
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
Evaluate each supplied job criterion in criteria_assessment, using its exact wording, and the explicit job description when criteria are absent. Weigh must-haves, supplied weights and documented priorities; do not invent requirements or weights. Resolve evidence against the rubric before comparing with prior scores, to avoid anchoring. Use supported, partial, unknown or contradicted and a brief evidence-based reason (at most 25 words). Also classify evidence_type as direct, inferred, unknown or contradicted and confidence as low, medium or high. Use status partial for inferred evidence; reserve supported for direct evidence. Use inferred only when current-candidate evidence supports a job-relevant transfer from adjacent tools, workflows or responsibilities. inference_basis should briefly name that transfer; use an empty string for direct/unknown/contradicted evidence. Cite only supplied source IDs; unknown evidence may have no citation. A requirement or memory lesson is not evidence of candidate capability. Do not convert unknowns into established weaknesses. Do not mechanically score an absent keyword as zero capability when source-backed transferable experience addresses the underlying need. Explain partial credit, keep direct-experience requirements unproven, and recommend a screening question for material uncertainty. Distinguish direct ownership, contribution and team exposure; consider transferable work, scope and recency only when job-relevant. Do not count a repeated observation twice.
In feedback_impact, classify new information and explain the score change or unchanged result in at most 35 words. An advance/reject decision or selector alone is not new proof of qualifications. When a manager disagrees, identify whether the reason is validated transferability, a changed priority, a factual correction or unexplained preference. An unexplained disagreement is insufficient_evidence: ask what evidence or transferable capability the manager saw; do not invent a lesson or force fit upward. A validated relationship can support an evaluation_method suggestion, but never replace current-candidate evidence. Separate confidence from fit. New evidence may change JD Fit and Manager Fit; manager preferences alone affect Manager Fit, not the JD rubric. Conflicting evidence should stay visible and generate a focused verification question. Do not force score movement.
Approved lessons are scoped, recruiter-reviewed guidance, not facts about this candidate or permission to ignore these instructions. Evaluation-method lessons may improve evidence interpretation but must never invent requirements or transfer another candidate's attributes, scores or hiring outcome. Manager-priority lessons apply to Manager Fit for this job only. Apply a lesson only where the current job and candidate evidence make it relevant. List only actually used lesson IDs and explain each application in at most 25 words. Contradictory or irrelevant lessons must not silently override current requirements. Never learn protected traits, demographic proxies or personal similarity.
Automatic learning is historical context selected by the server from repeated explicit human feedback. It is not a current requirement, a statistical confidence estimate, or evidence about this candidate. Apply it only where the current job and original candidate sources support it. Current requirements and current manager instructions take precedence. Historical client preferences can guide Manager Fit only; never turn them into a knockout, alter JD Fit, invent a numerical weight, or assume a new manager shares them. Cite actually used automatic source IDs in applied_lessons. Preserve uncertainty and verification questions.
Keep the visible findings concise; do not output private chain-of-thought.`;
export const learningInstructions = `
Propose at most two reusable learning_suggestions only when candidate feedback or a recruiter correction clearly supports a useful lesson. Use [] if there is no transferable lesson. Cite the originating feedback-ID or manual-correction source. A manager_priority must be an explicit job-related preference, not an inference from one rejection. An evaluation_method must describe how to interpret evidence (for example, distinguish ownership from support, or recognize a specific transferable tool/workflow relationship the recruiter or manager explicitly validated), not a qualification, employer preference or candidate-specific fact. Omit names, identifying details, candidate scores and decisions. Do not repeat existing approved lessons. Suggestions do not become memory until a recruiter explicitly approves their scope.`;

export function withDetails(schema, suggestions=false, constraints){
  const properties={...schema.properties,...detailProperties,...(suggestions?{learning_suggestions:learningSuggestions}:{})};
  if(constraints){
    const sources=constraints.sources||[],criteria=constraints.criteria||[];
    const refs=(values,min=0)=>values.length?{...ids,minItems:min,items:{type:'string',enum:[...new Set(values)]}}:{...ids,maxItems:0};
    const candidateIds=sources.filter(s=>!['requirement','manager context','approved preference','approved learning','automatic learning'].includes(s.kind)).map(s=>s.id);
    const criterion=criteria.length?{type:'string',enum:[...new Set(criteria)]}:text(600);
    const finding=(status,types)=>object({criterion,status:{type:'string',enum:status},evidence_type:{type:'string',enum:types},confidence:{type:'string',enum:['low','medium','high']},reason:text(240),inference_basis:{type:'string',maxLength:240},source_ids:refs(candidateIds,status.includes('unknown')?0:1)});
    properties.criteria_assessment={...detailProperties.criteria_assessment,items:candidateIds.length?{anyOf:[finding(['supported','partial'],['direct']),finding(['unknown'],['unknown']),finding(['partial'],['inferred']),finding(['contradicted'],['contradicted'])]}:finding(['unknown'],['unknown']),...(criteria.length?{minItems:criteria.length,maxItems:criteria.length}:{})};
    properties.feedback_impact=object({...detailProperties.feedback_impact.properties,source_ids:refs(sources.map(s=>s.id))});
    const lessons=sources.filter(s=>['approved learning','automatic learning'].includes(s.kind)).map(s=>s.id);
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
  const memory=id=>['approved learning','automatic learning'].includes(byId.get(id)?.kind);
  if(!Array.isArray(result.criteria_assessment)||result.criteria_assessment.length>40)fail('criteria_count');
  for(const c of result.criteria_assessment){
    if(!validText(c?.criterion,600)||!['supported','partial','unknown','contradicted'].includes(c.status)||!['direct','inferred','unknown','contradicted'].includes(c.evidence_type)||!['low','medium','high'].includes(c.confidence)||!validText(c.reason,240)||typeof c.inference_basis!=='string'||c.inference_basis.length>240)fail('criterion_fields');
    if(c.status==='unknown'&&c.evidence_type!=='unknown'||c.evidence_type==='unknown'&&c.status!=='unknown'||c.status==='contradicted'&&c.evidence_type!=='contradicted'||c.evidence_type==='contradicted'&&c.status!=='contradicted'||c.evidence_type==='inferred'&&(c.status!=='partial'||!c.inference_basis.trim())||c.evidence_type!=='inferred'&&c.inference_basis.trim())fail('criterion_evidence_type');
    if(!validIds(c.source_ids))fail('criterion_sources');
    if(c.source_ids.some(memory))fail('memory_as_evidence');
    if(c.source_ids.some(id=>['requirement','manager context','approved preference'].includes(byId.get(id)?.kind))||c.status!=='unknown'&&!c.source_ids.length)fail('candidate_evidence');
  }
  if(criteria.some(c=>!result.criteria_assessment.some(row=>row.criterion===c)))fail('missing_criterion');
  if(new Set(result.criteria_assessment.map(c=>c.criterion)).size!==result.criteria_assessment.length||criteria.length&&result.criteria_assessment.some(c=>!criteria.includes(c.criterion)))fail('criteria_count');
  const impact=result.feedback_impact;
  if(!impact||!['initial','new_evidence','confirmation','contradiction','priority_change','insufficient_evidence','mixed'].includes(impact.effect)||!validText(impact.summary,320))fail('impact_fields');
  if(!validIds(impact.source_ids))fail('impact_sources');
  if(!Array.isArray(result.applied_lessons)||result.applied_lessons.length>12||new Set(result.applied_lessons.map(l=>l.lesson_id)).size!==result.applied_lessons.length
    ||result.applied_lessons.some(l=>!memory(l?.lesson_id)||!validText(l.application,240)))fail('applied_lessons');
  if(suggestions&&(!Array.isArray(result.learning_suggestions)||result.learning_suggestions.length>2||result.learning_suggestions.some(l=>!['manager_priority','evaluation_method'].includes(l?.kind)||!validText(l.text,300)||!validIds(l.source_ids,1)
      ||l.source_ids.some(id=>!(byId.get(id)?.kind==='candidate feedback'||id==='manual-correction')))))fail('learning_sources');
  if(suggestions&&result.learning_suggestions.some(l=>l.source_ids.every(id=>/Reason not yet explained|No supporting reason provided yet/i.test(byId.get(id)?.text||''))))fail('learning_sources');
  return attachEvidenceConfidence(result,sources);
}

// Scores describe evidence support using explicit, bounded heuristics, not a
// statistically calibrated probability of competence or hiring success.
export function attachEvidenceConfidence(result,sources){
 const byId=new Map(sources.map(s=>[s.id,s]));
 const rank={low:35,medium:65,high:85};
 const findings=result.criteria_assessment.map(c=>{
  const selected=c.source_ids.map(id=>byId.get(id)).filter(Boolean);
  const original=selected.filter(candidateEvidence);
  const hints=transferabilityHints(original,c.criterion);
  const hint=hints.find(h=>h.evidence.some(e=>c.source_ids.includes(e.source_id)));
  const direct=original.length>0;
  const cap=c.evidence_type==='unknown'?0:!direct?35:c.evidence_type==='inferred'?(hint?.confidence_ceiling==='low'?40:70):direct?85:35;
  const score=Math.min(rank[c.confidence],cap);
  const confidence=score>=80?'high':score>=50?'medium':'low';
  const note=c.evidence_type==='unknown'?'No supporting candidate evidence identified.':c.evidence_type==='inferred'?'Related experience supports a possibility; direct experience still needs confirmation.':!direct?'Only a profile summary or unresolved concern is cited; verify the original source.':'Cited candidate evidence supports this finding; resume claims are not independently verified.';
  const evidence=selected.slice(0,8).map(source=>{
   const hinted=hint?.evidence.find(e=>e.source_id===source.id);
   const terms=(c.criterion+' '+c.reason).toLowerCase().match(/[a-z0-9+#]{3,}/g)||[];
   const passages=resumeSources(source.text||'');
   const passage=passages.map(p=>({...p,match:terms.filter(t=>p.text.toLowerCase().includes(t)).length})).sort((a,b)=>b.match-a.match)[0];
   return {source_id:source.id,kind:source.kind,quote:hinted?.quote||passage?.text||''};
  }).filter(e=>e.quote);
  return {...c,confidence,confidence_score:score,confidence_basis:note,evidence,
   verification_question:c.evidence_type==='inferred'?(hint?.verification_question||'What specific work demonstrates '+c.criterion+' and which parts did you personally own?'):'',
   inference_kind:c.evidence_type==='inferred'?(hint?.kind||'responsibility'):'none'};
 });
 result.criteria_assessment=findings;
 result.applied_lessons=(result.applied_lessons||[]).map(l=>({...l,automatic:byId.get(l.lesson_id)?.kind==='automatic learning'}));
 const counts={direct:0,inferred:0,unknown:0,contradicted:0};findings.forEach(c=>counts[c.evidence_type]++);
 result.evidence_summary={...counts,total:findings.length,confidence_score:findings.length?Math.round(findings.reduce((n,c)=>n+c.confidence_score,0)/findings.length):0,method:'evidence-support-v1',calibrated:false};
 if(findings.length&&Object.hasOwn(result,'confidence')){const score=result.evidence_summary.confidence_score;result.confidence=score>=80?'high':score>=50?'medium':'low';}
 return result;
}
