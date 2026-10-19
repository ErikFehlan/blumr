// Deterministic interpretation of source statements, not independent verification.
// Keep quotations unchanged. Interpretations are cached per passage, never per person.
import {normalize} from './screening-vocabulary.mjs';
const forms=[
 ['exposure','shadow shadowed shadowing shadows observe observed observing observes'],
 ['contribution','assist assisted assisting assists support supported supporting supports help helped helping helps contribute contributed contributing contributes participate participated participating participates collaborate collaborated collaborating collaborates'],
 ['ownership','own owned owning owns lead led leading leads manage managed managing manages direct directed directing directs supervise supervised supervising supervises mentor mentored mentoring mentors architect architected architecting architects'],
 ['implementation','build built building builds develop developed developing develops create created creating creates design designed designing designs implement implemented implementing implements establish established establishing establishes launch launched launching launches configure configured configuring configures install installed installing installs construct constructed constructing constructs author authored authoring authors integrate integrated integrating integrates standardize standardized standardizing standardizes redesign redesigned redesigning redesigns migrate migrated migrating migrates'],
 ['practice','use used using uses perform performed performing performs execute executed executing executes maintain maintained maintaining maintains operate operated operating operates administer administered administering administers reconcile reconciled reconciling reconciles process processed processing processes prepare prepared preparing prepares deliver delivered delivering delivers negotiate negotiated negotiating negotiates close closed closing closes source sourced sourcing sources screen screened screening screens coordinate coordinated coordinating coordinates assess assessed assessing assesses treat treated treating treats teach taught teaching teaches train trained training trains repair repaired repairing repairs inspect inspected inspecting inspects test tested testing tests analyze analyzed analyzing analyzes analyse analysed analysing analyses monitor monitored monitoring monitors resolve resolved resolving resolves document documented documenting documents track tracked tracking tracks verify verified verifying verifies plan planned planning plans schedule scheduled scheduling schedules facilitate facilitated facilitating facilitates measure measured measuring measures reduce reduced reducing reduces increase increased increasing increases restore restored restoring restores pick picked picking picks pack packed packing packs receive received receiving receives reproduce reproduced reproducing reproduces validate validated validating validates diagnose diagnosed diagnosing diagnoses calibrate calibrated calibrating calibrates dispense dispensed dispensing dispenses remediate remediated remediating remediates generate generated generating generates']
];
const depths=new Map(forms.flatMap(([depth,words])=>words.split(' ').map(word=>[word,depth])));
export const evidenceActionPattern=new RegExp('\\b(?:'+[...depths.keys()].join('|')+')\\b','ig');
const actions=text=>[...text.matchAll(evidenceActionPattern)].map(m=>({at:m.index,end:m.index+m[0].length,word:m[0].toLowerCase(),depth:depths.get(m[0].toLowerCase())}));
const actorRE=/\b(?:my|our|the|their|a|an)\s+(?:(?:platform|infrastructure|engineering|project|clinical|software|external|senior)\s+){0,3}(?:manager|supervisor|colleague|coworker|co-worker|teammate|team|vendor|consultant|engineer|director|nurse)s?\b|\b(?:he|she|they|we)\b/i;
function actorOf(text,activity){
 // "Managed a team" names an object, not the subject who did the managing.
 const first=activity[0],prefix=first?text.slice(0,first.at):text;
 const subject=prefix.match(actorRE),self=prefix.match(/\bi\b/i);
 if(self&&(!subject||self.index<subject.index))return 'applicant';
 if(subject)return /\b(team|we)\b/i.test(subject[0])?'team':'other';
 return 'applicant'; // Standard resume bullets omit "I".
}
const cache=new WeakMap();
const interpretationCache=new WeakMap(),patterns=new Map();
const subjects='I|we|my|our|the|their|he|she|they';
const finite=[...depths.keys()].filter(w=>!w.endsWith('ing')).join('|');
const boundary=new RegExp(';\\s*|,\\s*(?=(?:'+subjects+'|'+finite+')\\b)|\\s+\\b(?:while|whereas|but|however)\\b\\s+|\\s+\\band\\b\\s+(?=(?:'+subjects+')\\b)','ig');
function clausesFor(p){
 if(cache.has(p))return cache.get(p);
 const text=p.normalized,spans=[];let start=0;
 // A new explicit subject can change attribution; an omitted subject inherits it.
 let inherited='applicant';
 const append=end=>{
  const raw=text.slice(start,end),activity=actions(raw),own=actorRE.test(raw)||/\bi\b/i.test(raw);
  const actor=own?actorOf(raw,activity):inherited;
  spans.push({start,end,text:raw,actor,actions:activity});
  inherited=actor;
 };
 for(const m of text.matchAll(boundary)){append(m.index);start=m.index+m[0].length;}
 append(text.length);cache.set(p,spans);return spans;
}
export function interpretEvidence(pattern,p){
 const key=pattern.source+'/'+pattern.flags;
 let memo=interpretationCache.get(p);
 if(!memo){memo=new Map();interpretationCache.set(p,memo);}
 if(memo.has(key))return memo.get(key);
 pattern.lastIndex=0;
 if(!pattern.test(p.normalized)){memo.set(key,null);return null;}
 let repeated=patterns.get(key);
 if(!repeated){
  repeated=new RegExp(pattern.source,pattern.flags.replaceAll('g','')+'g');
  patterns.set(key,repeated);if(patterns.size>2048)patterns.delete(patterns.keys().next().value);
 }
 const found=[...p.normalized.matchAll(repeated)];
 const rows=found.map(match=>interpretMatch(match,p));
 // A later personal statement must not disappear behind an earlier team
 // mention. Personal denials remain conflicts, never silently overwritten.
 const result=rows.find(r=>r.actor==='applicant'&&r.negative&&r.modality==='asserted')||
  rows.find(r=>r.substantive)||rows.find(r=>r.actor==='applicant'&&r.modality==='asserted')||rows[0]||null;
 memo.set(key,result);return result;
}
function interpretMatch(match,p){
 const at=match.index+(match[0].match(/^[^\p{L}\p{N}_]/u)?.[0].length||0);
 const segment=clausesFor(p).find(c=>at>=c.start&&at<c.end)||clausesFor(p).at(-1);
 const pos=at-segment.start,before=segment.text.slice(0,pos),after=segment.text.slice(pos);
 const preceding=segment.actions.filter(a=>a.at<=pos),following=segment.actions.filter(a=>a.at>pos);
 // Passive form ("Azure was implemented by me") binds the following action.
 const passive=/^[\s\S]{0,100}?\b(?:was|were|is|are|has been|have been)\s+/.test(after);
 let action=preceding.at(-1)||(passive?following[0]:null);
 // A gerund in an object list ("implement controls, ... and monitoring")
 // stays governed by the preceding action rather than becoming a new claim.
 if(action?.word.endsWith('ing')&&/,\s*(?:and\s+)?$/.test(segment.text.slice(0,action.at))){
  action=preceding.filter(a=>!a.word.endsWith('ing')).at(-1)||action;
 }
 let actor=p.inheritedActor||segment.actor;
 const by=segment.text.match(/\bby\s+(me|us|myself|(?:our|the|my|their|an?|external)\s+[^.;]{1,70})/i);
 if(passive&&by)actor=/^(me|myself)$/i.test(by[1])?'applicant':/^us$/i.test(by[1])?'team':'other';
 // Coordinated actions have local depth; "helped to implement" stays contribution.
 const conjunction=action?segment.text.lastIndexOf(' and ',action.at):-1;
 const localStart=conjunction<0?0:conjunction+5;
 const local=segment.text.slice(localStart);
 const limited=segment.actions.find(a=>a.at>=localStart&&['contribution','exposure'].includes(a.depth)&&(!action||a.at<=action.at));
 const uncertain=p.section==='list'||/^(?:skills|tools|technologies)\s*:/i.test(p.normalized)||/\b(familiar with|exposure to|awareness of|studying|learning|interested in)\b/i.test(local);
 const hypothetical=/\b(would|could|might|will|plan to|plans to|planned to|hope to|hopes to|intend to|intends to|if selected|if hired)\b/i.test(segment.text);
 const requirement=/\b(required|preferred|must (?:have|hold)|candidates? (?:should|must)|job (?:description|requires?)|project required)\b/i.test(segment.text);
 const negs=[...before.matchAll(/\b(no|not(?! only\b| just\b)|never|without|lack(?:s|ed|ing)?|haven't|hasn't|didn't|doesn't|don't|cannot|can't|unfamiliar)\b/ig)];
 const last=negs.at(-1);
 // "No downtime ..., I implemented" is a separate clause. Within one clause,
 // a negator after the action applies to its object ("used no Terraform").
 const negative=actor==='applicant'&&(Boolean(last)||/^[\s\S]{0,80}?\b(?:experience\s+)?(?:is|was)\s+(?:not|none|only theoretical)\b/i.test(after));
 const depth=uncertain?'exposure':limited?.depth||action?.depth||(/\b(?:responsible|accountable) for\b/i.test(local)?'ownership':'mention');
 const substantive=actor==='applicant'&&!negative&&!hypothetical&&!requirement&&!['mention','exposure','contribution'].includes(depth);
 return {actor,negative,substantive,depth,action:action?.word||null,modality:hypothetical?'hypothetical':requirement?'requirement':'asserted',clause:segment.text};
}
// Only remove population descriptors from clinical/teaching objects. Applicant
// characteristics remain excluded by the caller; no trait is a scoring signal.
export function workEvidenceText(text){
 return normalize(text).replace(/\b(?:male|female|pregnant|disabled|young|elderly)\s+(?=(?:patients?|students?|clients?)\b)/g,'');
}
export function evidencePassages(range){
 const lines=[];let offset=0;
 for(const raw of range.split(/(\n+)/)){
  if(/^\n+$/.test(raw)){offset+=raw.length;continue;}
  const quote=raw.trim();if(!quote){offset+=raw.length;continue;}
  const start=offset+raw.indexOf(quote),prev=lines.at(-1);
  const continuation=prev&&!/[.!?;:]$/.test(prev.quote)&&/^[a-z]/.test(quote)&&
   !actions(quote).some(a=>a.at===0)&&!/\b(?:19|20)\d{2}\b/.test(quote)&&prev.quote.length+quote.length<1200;
  if(continuation){prev.end=start+quote.length;prev.quote=range.slice(prev.start,prev.end);}
  else lines.push({start,end:start+quote.length,quote});
  offset+=raw.length;
 }
 const out=[];
 for(const line of lines){
  let start=0;
  for(const m of line.quote.matchAll(/(?<=[.!?;])\s+|,?\s+\b(?:but|however|whereas)\b\s+/ig)){
   const prefix=line.quote.slice(0,m.index);
   if(/\b(?:B\.Sc|M\.Sc|B\.S|B\.A|M\.S|Ph\.D)\.$/i.test(prefix))continue;
   const quote=line.quote.slice(start,m.index).trim();if(quote)out.push(quote);start=m.index+m[0].length;
  }
  const quote=line.quote.slice(start).trim();if(quote)out.push(quote);
 }
 return out;
}
