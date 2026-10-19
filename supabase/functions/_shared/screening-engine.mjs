// Shared, provider-free screening kernel. Callers must authorize workspace/job access.
import {evidenceTextRanges,isSourceInstruction} from './source-instructions.mjs';
import {unsafeScreeningText} from './screening-rule-spec.mjs';
export const screeningVersion='screening-v2';
const norm=s=>String(s).normalize('NFKC').toLowerCase().replace(/[‐‑–—]/g,'-').replace(/\s+/g,' ').trim();
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const termRE=t=>new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escape(norm(t))}(?=$|[^\\p{L}\\p{N}_])`,'u');
const negation=/\b(no|not(?! only\b| just\b)|never|without|lack(?:s|ed|ing)?|haven't|hasn't|didn't|cannot|unfamiliar)\b/ig;
const limited=/\b(familiar|exposure|observed|studying|learning|interested|assisted|shadowed|participated|helped|team\s+(?:used|built|implemented|designed|managed))\b/i;
const action=/\b(built|designed|implemented|developed|owned|led|managed|performed|reconciled|prepared|processed|operated|administered|delivered|maintained|tested|used|coordinated|negotiated|treated|assessed|sourced|screened|analyzed|analysed|taught|trained|repaired|inspected|monitored|resolved|documented|tracked|verified|planned|scheduled|facilitated|measured|reduced|increased|closed)\b/i;
const personal={test:unsafeScreeningText};
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export async function fingerprint(value){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stable(value)));
 return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
function terms(values){
 if(!Array.isArray(values)||values.length>30||values.some(t=>typeof t!=='string'||!t.trim()||t.length>120||personal.test(t)||isSourceInstruction(t)))throw Error('invalid_screening_terms');
 return [...new Set(values.map(norm))];
}
function condition(input,depth=0,budget={nodes:0}){
 if(!input||depth>4||++budget.nodes>200)throw Error('invalid_screening_condition');
 const keys=['all','any','terms'].filter(k=>Object.hasOwn(input,k));
 if(keys.length!==1)throw Error('invalid_screening_condition');
 const key=keys[0];
 if(key==='terms'){
  const direct=terms(input.terms),related=terms(input.related||[]);
  if(!direct.length)throw Error('empty_screening_terms');
  return {terms:direct,related};
 }
 if(!Array.isArray(input[key])||!input[key].length||input[key].length>20)throw Error('invalid_screening_group');
 return {[key]:input[key].map(c=>condition(c,depth+1,budget))};
}
// Use the existing canonical priority items. No new model call, guessed weights,
// requirements or implicit synonyms. Conditions are explicit versioned configuration.
export async function buildScreeningRubric({workspaceId,jobId,jobVersion,feedbackVersion='',priorities,rules,titleTerms=[]}){
 if(!workspaceId||!jobId||!jobVersion||!Array.isArray(priorities)||!priorities.length||priorities.length>5||!Array.isArray(rules)||rules.length!==priorities.length)throw Error('invalid_screening_rubric');
 const ids=new Set(priorities.map(p=>p.id));
 if(ids.size!==priorities.length||priorities.some(p=>!p.id||!p.title||!p.source_quote||!['required','preferred','inferred'].includes(p.requirement_type)||personal.test(p.title)||isSourceInstruction(p.title)))throw Error('invalid_screening_priorities');
 const seen=new Set();
 const compiled=rules.map(r=>{
  if(!ids.has(r.priorityId)||seen.has(r.priorityId)||!Number.isFinite(r.weight)||r.weight<=0||r.weight>100)throw Error('invalid_screening_rule');
  seen.add(r.priorityId);
  const p=priorities.find(p=>p.id===r.priorityId);
  return {priorityId:p.id,title:p.title,requirementType:p.requirement_type,sourceQuote:p.source_quote,weight:r.weight,condition:condition(r.condition)};
 });
 const body={version:screeningVersion,workspaceId,jobId,jobVersion,feedbackVersion,rules:compiled,titleTerms:terms(titleTerms)};
 return {...body,key:await fingerprint(body)};
}
export function parseScreeningEvidence(text){
 if(typeof text!=='string'||text.length>1000000)throw Error('invalid_resume_text');
 const passages=[];
 for(const range of evidenceTextRanges(text))for(const raw of range.split(/\n+|(?<=[.!?;])\s+|,?\s+\b(?:but|however|whereas)\b\s+/i)){
  const quote=raw.trim();if(!quote||personal.test(quote)||isSourceInstruction(quote))continue;
  passages.push({sourceId:`screening-${passages.length+1}`,quote,normalized:norm(quote)});
 }
 return {passages,reviewRequired:!passages.length,parserVersion:screeningVersion};
}
function matchEvidence(pattern,passage){
 const match=pattern.exec(passage.normalized);if(!match)return null;
 // Scope negation to the matched capability, not incidental outcomes such as
 // "implemented Azure without downtime". Negative lists remain negative.
 const at=match.index+(match[0].match(/^[^\p{L}\p{N}_]/u)?.[0].length||0);
 const before=passage.normalized.slice(0,at),after=passage.normalized.slice(match.index+match[0].length);
 const negatives=[...before.matchAll(negation)],last=negatives.at(-1);
 const tail=last?before.slice(last.index+last[0].length):'';
 const newClause=tail.includes(',')&&action.test(tail.slice(tail.lastIndexOf(',')+1));
 const negative=Boolean(last&&!newClause)
  || /^\s*(?:experience\s*)?(?:(?:is|was)\s+)?(?:not\b|none\b|only theoretical\b)/i.test(after);
 const substantive=action.test(passage.quote)&&!limited.test(passage.quote);
 return {negative,substantive};
}
function compile(c){
 if(c.all)return {all:c.all.map(compile)};
 if(c.any)return {any:c.any.map(compile)};
 return {direct:c.terms.map(termRE),related:c.related.map(termRE)};
}
function evaluate(c,passages){
 if(c.all||c.any){
  const all=Boolean(c.all),rows=(c.all||c.any).map(x=>evaluate(x,passages));
  const value=all?Math.min(...rows.map(r=>r.value)):Math.max(...rows.map(r=>r.value));
  return {value,evidence:rows.flatMap(r=>r.evidence),status:value===1?'supported':value>0?'partial':rows.some(r=>r.status==='contradicted')?'contradicted':'unknown'};
 }
 const evidence=[];let value=0,contradicted=false;
 for(const p of passages){
  const directMatches=c.direct.map(rx=>matchEvidence(rx,p)).filter(Boolean),relatedMatches=c.related.map(rx=>matchEvidence(rx,p)).filter(Boolean);
  const direct=directMatches.length>0,related=relatedMatches.length>0;
  if(!direct&&!related)continue;
  const matches=direct?directMatches:relatedMatches;
  const negative=matches.every(m=>m.negative),substantive=matches.some(m=>!m.negative&&m.substantive);
  const v=negative?0:direct?(substantive?1:0.35):(substantive?0.5:0.15);
  contradicted ||= negative&&direct;
  value=Math.max(value,v);
  evidence.push({sourceId:p.sourceId,quote:p.quote,type:negative?'contradicted':direct?'direct':'inferred',depth:substantive?'practice':'mention',value:v});
 }
 if(contradicted)value=Math.min(value,0.35);
 // Keep evidence responsible for the score even after many earlier mentions.
 return {value,status:contradicted?'contradicted':value===1?'supported':value>0?'partial':'unknown',evidence:evidence.sort((a,b)=>(b.type==='contradicted')-(a.type==='contradicted')||b.value-a.value).slice(0,12)};
}
export function compileScreeningRubric(rubric){
 return {...rubric,compiled:rubric.rules.map(r=>({...r,compiledCondition:compile(r.condition)})),compiledTitles:rubric.titleTerms.map(termRE)};
}
export function scoreScreeningCandidate(compiled,evidence,candidateId){
 if(!candidateId)throw Error('missing_candidate_id');
 const findings=compiled.compiled.map(r=>({priorityId:r.priorityId,title:r.title,weight:r.weight,requirementType:r.requirementType,...evaluate(r.compiledCondition,evidence.passages)}));
 const total=findings.reduce((n,r)=>n+r.weight,0);
 const reviewRequired=evidence.reviewRequired||findings.some(r=>r.status!=='supported');
 return {candidateId,rubricKey:compiled.key,score:Math.round(10000*findings.reduce((n,r)=>n+r.weight*r.value,0)/total)/100,
  findings,titleSignal:evidence.passages.some(p=>compiled.compiledTitles.some(rx=>rx.test(p.normalized))),reviewRequired,
  // Screening never rejects; even explicit negatives remain reviewable.
  decision:'recruiter_review',aiCalls:0};
}
export function rankScreeningCandidates(results,{complete=false,top=20,nearMiss=20}={}){
 if(!Number.isInteger(top)||top<1||!Number.isInteger(nearMiss)||nearMiss<0)throw Error('invalid_shortlist_size');
 if(new Set(results.map(r=>r.candidateId)).size!==results.length)throw Error('duplicate_candidate_id');
 if(new Set(results.map(r=>r.rubricKey)).size>1)throw Error('mixed_screening_rubrics');
 const ranked=[...results].sort((a,b)=>b.score-a.score||String(a.candidateId).localeCompare(String(b.candidateId),'en'));
 return {status:complete?'final':'provisional',evaluated:results.length,top:ranked.slice(0,top),nearMiss:ranked.slice(top,top+nearMiss),remaining:ranked.slice(top+nearMiss),aiCalls:0};
}
// Bounded per-instance cache, scoped by workspace/job/rubric and exact resume bytes.
// Durable cache and cross-worker AI idempotency belong in the authorized backend.
export function createScreeningSession(rubric,{maxEntries=2000}={}){
 if(!Number.isInteger(maxEntries)||maxEntries<1||maxEntries>10000)throw Error('invalid_cache_limit');
 const compiled=compileScreeningRubric(rubric),cache=new Map();
 return {async score(candidateId,text){
  const key=await fingerprint({rubric:rubric.key,text});let result=cache.get(key),cacheHit=Boolean(result);
  if(!result){result=scoreScreeningCandidate(compiled,parseScreeningEvidence(text),candidateId);cache.set(key,result);if(cache.size>maxEntries)cache.delete(cache.keys().next().value);}
  return {...structuredClone(result),candidateId,cacheHit};
 },get cacheSize(){return cache.size;}};
}
