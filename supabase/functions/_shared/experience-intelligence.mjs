import {candidateEvidence} from './transferability.mjs';
import {evidenceTextRanges} from './source-instructions.mjs';
import {capabilityWorkflows} from './capability-workflows.mjs';

export const intelligenceVersion='experience-intelligence-v2';
export const criterionKey=text=>String(text||'').toLowerCase().replace(/[^a-z0-9+#]+/g,' ').trim();
const list=v=>Array.isArray(v)?v:[];
const unique=values=>[...new Set(values)];
const stop=new Set('must have preferred required experience skills skill ability knowledge strong proven demonstrated with within from that this their they candidate years year minimum relevant working work'.split(' '));
const tokens=text=>unique(criterionKey(text).split(' ').filter(t=>t.length>2&&!stop.has(t)));
const overlap=(a,b)=>tokens(a).filter(t=>tokens(b).some(v=>v===t||v.length>4&&t.length>4&&v.slice(0,-1)===t.slice(0,-1))).length;
const monthNames='jan feb mar apr may jun jul aug sep oct nov dec'.split(' ');
const datePart='(?:0?[1-9]|1[0-2])/(?:19|20)\\d{2}|(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\s+)?(?:19|20)\\d{2}';
const rangeRE=new RegExp('('+datePart+')\\s*(?:[-–—]|to)\\s*('+datePart+'|present|current|now)','i');
const actionGroups=[
 ['exposure',/\b(shadowed|observed|exposure to|familiar with|awareness of|team used|team using)\b/i],
 ['contribution',/\b(assisted|supported|contributed|participated|helped|collaborated)\b/i],
 ['ownership',/\b(owned|led|managed|directed|supervised|accountable for|responsible for)\b/i],
 ['implementation',/\b(built|developed|created|designed|implemented|established|launched|configured|installed|constructed|authored|integrated|standardized|redesigned)\b/i],
 ['practice',/\b(used|performed|maintained|operated|administered|reconciled|processed|prepared|delivered|negotiated|closed|sourced|screened|coordinated|assessed|taught|trained|repaired|inspected|tested|analyzed|analysed|monitored|resolved|documented|tracked|verified|planned|scheduled|facilitated|measured|reduced|increased)\b/i]
];
const limited=/\b(?:no|never|not|without|lack(?:ed|s)?|didn't|doesn't|haven't|hasn't|couldn't|cannot|can't|unable|only observed|only assisted|only supported|studying|learning|interested in|plan to|hopes? to)\b/i;
const team=/\b(?:our|the|their|my)\s+team\s+(?:owned|led|managed|built|developed|performed|used|implemented)/i;
const credential=/\b(licen[cs]e[ds]?|licensure|certification|certified|registration|registered nurse|board certified|clearance|degree|diploma|CPA|RN|LPN|CDL)\b/i;

function dateValue(text,asOf){
 if(/^(present|current|now)$/i.test(text))return {month:asOf.getUTCFullYear()*12+asOf.getUTCMonth(),precision:'month',current:true};
 const numeric=text.match(/^(\d{1,2})\/(\d{4})$/),named=text.match(/^([a-z]+)\s+(\d{4})$/i);
 if(numeric)return {month:Number(numeric[2])*12+Number(numeric[1])-1,precision:'month'};
 if(named&&monthNames.includes(named[1].slice(0,3).toLowerCase()))return {month:Number(named[2])*12+monthNames.indexOf(named[1].slice(0,3).toLowerCase()),precision:'month'};
 if(/^\d{4}$/.test(text))return {month:Number(text)*12,precision:'year'};
 return null;
}
function interval(text,asOf){
 const m=text.match(rangeRE);if(!m)return null;
 const start=dateValue(m[1],asOf),end=dateValue(m[2],asOf);
 if(!start||!end||start.month>end.month||end.month>asOf.getUTCFullYear()*12+asOf.getUTCMonth())return null;
 return {start_month:start.month,end_month:end.month+1,precision:start.precision==='month'&&end.precision==='month'?'month':'year',current:Boolean(end.current),source_date_text:m[0]};
}
function unionMonths(ranges){
 const sorted=ranges.filter(r=>r.precision==='month').sort((a,b)=>a.start_month-b.start_month);let total=0,end=-1;
 for(const r of sorted){total+=Math.max(0,r.end_month-Math.max(r.start_month,end));end=Math.max(end,r.end_month);}return total;
}

export function buildExperienceIntelligence(sources,job={},options={}){
 const asOf=new Date(options.asOf||Date.now());if(Number.isNaN(asOf.getTime()))throw Error('invalid_assessment_date');
 const all=list(sources).filter(candidateEvidence),full=all.find(s=>s.id==='resume-full');
 const originals=full?all.filter(s=>!s.kind.startsWith('resume quotation')||s===full):all;
 const facts=[],episodes=[],seen=new Set();let employer='',episode=null,excludedSection=false;
 for(const source of originals){
  const resume=source.kind.startsWith('resume quotation');
  if(!resume){episode=null;employer='';excludedSection=false;}
  for(const range of evidenceTextRanges(String(source.text||''))){
   for(const raw of range.split(/\n+|(?<=[.!?;])\s+/)){
    const quote=raw.trim();if(!quote||quote.length>1000)continue;
    if(resume){
     if(/^(education|certifications?|personal (?:information|details)|interests|references)\s*:?$/i.test(quote)){excludedSection=true;episode=null;}
     if(/^(work|professional|employment|relevant|consulting|project)\s+(history|experience|engagements|projects)\s*:?$/i.test(quote))excludedSection=false;
     const namedEmployer=quote.match(/^(?:employer|consulting firm|employed by)\s*:\s*(.{2,120})/i);
     if(namedEmployer){employer=namedEmployer[1].replace(rangeRE,'').trim();excludedSection=false;}
     const dates=!excludedSection?interval(quote,asOf):null;
     if(dates){
      episode={id:'episode-'+(episodes.length+1),...dates,header:quote,source_id:source.id,
       engagement:/\b(client|contract|consulting|consultant|engagement|project assignment)\b/i.test(quote)?'project':'unspecified',employer:employer||null};
      episodes.push(episode);
     }
    }
    if(excludedSection||quote.length<12)continue;
    const group=actionGroups.find(([,pattern])=>pattern.test(quote));if(!group)continue;
    const key=criterionKey(quote);if(seen.has(key))continue;seen.add(key);
    const limitation=limited.test(quote),depth=team.test(quote)?'team_exposure':group[0];
    facts.push({id:'activity-'+(facts.length+1),source_id:source.id,quote,depth,
     limited:limitation,episode_id:resume?episode?.id||null:null,
     measures:unique(quote.match(/(?:[$£€]\s?\d[\d,.]*(?:\s?(?:million|billion|m|k))?|\b\d[\d,.]*\s?(?:%|percent|patients|clients|accounts|employees|people|sites|stores|units|orders|projects|hours|days|weeks|months|years))(?!\w)/gi)||[]).slice(0,3)});
   }
  }
 }
 const criteria=list(job.criteria||job.requirements).filter(c=>typeof c==='string'),context=[job.description,...criteria].filter(Boolean).join(' ');
 const scored=facts.map((f,i)=>({f,i,score:Math.max(0,...criteria.map(c=>overlap(c,f.quote)))})).sort((a,b)=>b.score-a.score||a.i-b.i);
 const selected=scored.slice(0,36).map(x=>x.f),selectedIds=new Set(selected.map(f=>f.id));
 const workflows=[];
 for(const workflow of capabilityWorkflows){
  if(!workflow.names.some(name=>(' '+criterionKey(context)+' ').includes(' '+criterionKey(name)+' ')))continue;
  const groups=new Map();
  for(const fact of facts.filter(f=>!f.limited&&!['exposure','team_exposure','contribution'].includes(f.depth))){
   const group=fact.episode_id||fact.source_id;
   const stages=workflow.phases.filter(([,pattern])=>new RegExp('\\b(?:'+pattern+')','i').test(fact.quote));
   if(!stages.length)continue;
   if(!groups.has(group))groups.set(group,new Map());
   for(const [stage] of stages)if(!groups.get(group).has(stage))groups.get(group).set(stage,fact);
  }
  const best=[...groups.values()].sort((a,b)=>b.size-a.size)[0];if(!best||best.size<2||new Set([...best.values()].map(f=>f.id)).size<2)continue;
  workflows.push({key:workflow.key,names:workflow.names,phases:[...best.keys()],missing_phases:workflow.phases.map(([p])=>p).filter(p=>!best.has(p)),
   evidence:unique([...best.values()].map(f=>f.id)).map(id=>{const f=facts.find(f=>f.id===id);return {source_id:f.source_id,quote:f.quote,depth:f.depth};}).slice(0,4),
   confidence_ceiling:'medium',status:'partial',note:'Connected activities suggest a workflow; exact scope and personal ownership still need checking.'});
 }
 const relevantEpisodes=episodes.filter(e=>selected.some(f=>f.episode_id===e.id)).slice(0,20);
 const projects=relevantEpisodes.filter(e=>e.engagement==='project');
 return {version:intelligenceVersion,as_of:asOf.toISOString().slice(0,10),activities:selected,
  workflows:workflows.slice(0,8),career:{episodes:relevantEpisodes,
   documented_months:relevantEpisodes.some(e=>e.precision==='month')?unionMonths(relevantEpisodes):null,partial_dates:relevantEpisodes.some(e=>e.precision!=='month'),
   has_overlaps:relevantEpisodes.some((a,i)=>relevantEpisodes.slice(i+1).some(b=>a.start_month<b.end_month&&b.start_month<a.end_month)),
   consulting_projects:projects.length,explicit_employer_groups:unique(projects.map(e=>e.employer).filter(Boolean)).map(name=>({employer:name,projects:projects.filter(e=>e.employer===name).length})),
   note:'Dates describe documented work periods, not years using each skill. Overlaps count once; project engagements do not establish separate employers. No age or career-gap penalty.'},
  truncated:scored.length>selectedIds.size};
}

export function intelligencePrompt(profile){
 // Original sources already contain the quotations. Reuse their IDs and keep
 // the additional context bounded, regardless of resume length or occupation.
 return {version:profile.version,activities:profile.activities.slice(0,20).map(f=>({source_id:f.source_id,activity:f.quote.slice(0,260),depth:f.depth,limited:f.limited,episode_id:f.episode_id})),
  workflows:profile.workflows.map(w=>({key:w.key,phases:w.phases,missing_phases:w.missing_phases,source_ids:unique(w.evidence.map(e=>e.source_id))})),
  career:{...profile.career,episodes:profile.career.episodes.map(({header,...e})=>e)}};
}

export function historyForCriterion(sources,criterion,kind){
 const row=list(sources).filter(s=>s.kind==='automatic learning').map(s=>s.inference_history).find(h=>h?.criterion_key===criterionKey(criterion)&&(!kind||h.inference_kind===kind));
 if(!row)return null;
 const {confirmed,contradicted,candidates,jobs}=row;
 if(![confirmed,contradicted,candidates,jobs].every(Number.isInteger)||Math.min(confirmed,contradicted,candidates,jobs)<0||confirmed+contradicted!==candidates||candidates<6||jobs<2)return null;
 return {confirmed,contradicted,candidates,jobs,criterion_key:row.criterion_key,inference_kind:row.inference_kind};
}
export function enrichExperience(result,sources,job={},profile=buildExperienceIntelligence(sources,job)){
 const rows=list(result.criteria_assessment).map(c=>{
  const activities=profile.activities.filter(f=>list(c.source_ids).includes(f.source_id)&&overlap(c.criterion,f.quote)>0).slice(0,4);
  const workflow=profile.workflows.find(w=>w.names.some(n=>criterionKey(c.criterion).includes(criterionKey(n))));
  const kind=c.evidence_type==='inferred'?(workflow?'workflow':c.inference_kind||'responsibility'):'none';
  const history=c.evidence_type==='inferred'?historyForCriterion(sources,c.criterion,kind):null;
  let score=c.confidence_score;
  // Historical accuracy changes evidence confidence only. The model still
  // needs current candidate evidence before assigning any fit score.
  if(history){
   if(history.confirmed/history.candidates<0.5)score=Math.min(score,35);
   else if(history.candidates>=12&&history.jobs>=3&&history.confirmed/history.candidates>=0.8&&activities.some(f=>!f.limited&&!['exposure','team_exposure','contribution'].includes(f.depth)))score=Math.min(70,score+10);
  }
  if(c.evidence_type==='inferred'&&credential.test(c.criterion))score=Math.min(score,35);
  const confidence=score>=80?'high':score>=50?'medium':'low';
  return {...c,inference_kind:kind,confidence_score:score,confidence,confidence_basis:(c.confidence_basis||'Evidence support estimate.')+(score!==c.confidence_score&&history?' Adjusted using later explicit checks of comparable inferences; this is not a calibrated probability.':''),experience_depth:activities,
   ...(workflow?{workflow_evidence:workflow}:{}),...(history?{inference_history:history}:{}),
   ...(c.evidence_type==='inferred'?{inference_key:criterionKey(c.criterion)}:{})};
 });
 const unresolved=rows.filter(c=>c.status!=='supported');
 const priorities=list(job.hiring_priorities?.items);
 const questions=unresolved.map((c,index)=>{
  const knockout=list(job.knockouts).some(k=>criterionKey(k)===criterionKey(c.criterion));
  const must=knockout||/\b(must|required|essential|mandatory)\b/i.test(c.criterion);
  const priority=priorities.some(p=>overlap(p.title,c.criterion)>0);
  const ownership=/\b(ownership|own|lead|manage|supervis|responsib)/i.test(c.criterion)&&c.experience_depth.some(f=>['contribution','exposure','team_exposure'].includes(f.depth));
  const question=credential.test(c.criterion)?`What current documentation verifies ${c.criterion}?`:
   ownership?`Which parts of ${c.criterion} did you personally own, and what decisions were yours?`:
   c.workflow_evidence?.missing_phases.length?`For ${c.criterion}, what work did you personally do in ${c.workflow_evidence.missing_phases.slice(0,2).join(' and ')}?`:
   c.verification_question||`What specific work demonstrates ${c.criterion}, and what did you personally do?`;
  return {criterion:c.criterion,question:question.length<=600?question:question.slice(0,597)+'...',
   reason:must?'Resolves an explicit required qualification.':priority?'Clarifies a stated job priority.':c.status==='contradicted'?'Resolves conflicting candidate evidence.':'Clarifies uncertain job-related evidence.',
   priority:(must?100:0)+(priority?40:0)+(c.status==='contradicted'?30:c.status==='unknown'?20:10)+(100-c.confidence_score)/10,index};
 }).sort((a,b)=>b.priority-a.priority||a.index-b.index).slice(0,2).map(({priority,index,...q})=>q);
 result.criteria_assessment=rows;result.experience_profile=profile;result.verification_priorities=questions;
 if(questions.length){if(Array.isArray(result.screening_questions))result.screening_questions=questions.map(q=>q.question.slice(0,220));if(Array.isArray(result.questions))result.questions=questions.map(q=>q.question.slice(0,220));}
 if(result.evidence_summary){result.evidence_summary.method=intelligenceVersion;result.evidence_summary.confidence_score=rows.length?Math.round(rows.reduce((n,c)=>n+c.confidence_score,0)/rows.length):0;}
 if(rows.length&&Object.hasOwn(result,'confidence')){const score=result.evidence_summary?.confidence_score||0;result.confidence=score>=80?'high':score>=50?'medium':'low';}
 return result;
}

export const experienceInstructions=`
ROLE-NEUTRAL EXPERIENCE AND WORKFLOWS
Assess any occupation against its actual requirements. Do not assume that a role needs software, technical tools, a degree, or leadership unless supplied. The experience_intelligence object is a bounded code interpretation of original sources, not independent evidence. Its activities retain source IDs. Verify their meaning against the original text: leading, implementing, routine practice, contribution, and team exposure are different responsibilities, not a universal ranking of people. Consider scope, concrete outcomes and recency only where relevant to the actual job; never assume responsibility from a title or years using a skill from employment dates.
Connected activities may support a workflow even when its label is absent. Assess unlisted workflows from source-backed activities too; the workflow examples are not a list of supported occupations. Multiple synonyms for one activity are not separate stages. Activities from different jobs or unrelated contexts do not establish end-to-end ownership. Preserve missing stages, supervision and limitations. Transfer never proves a license, credential, degree, required years or required direct experience.
Respect explicit employer/client relationships. Several consulting projects may be engagements under one employer. Keep ambiguous histories unknown, count overlapping work periods once, and do not infer age or penalize gaps, short projects, or consulting status. Work-history dates are not independently verified and are not evidence of a skill's duration.
Prioritize at most two screening questions that could materially change the assessment, especially explicit required qualifications. Use answers already present in saved notes before asking again. Historical inference confirmations are observational context, never facts about this candidate or probability of hiring success. A hiring decision alone is not a correctness label.`;
