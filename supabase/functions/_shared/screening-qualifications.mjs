import {interval,unionMonths} from './experience-intelligence.mjs';
import {normalize,hasTerm,escapeRE,capabilityWorkflows,titleFamilies} from './screening-vocabulary.mjs';

import {interpretEvidence,evidenceActionPattern} from './screening-evidence.mjs';

const numbers={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20};
const numberPattern='(?:\\d+(?:\\.\\d+)?|'+Object.keys(numbers).join('|')+')';
export const durationPattern=new RegExp('\\b('+numberPattern+')(?:\\s*(?:[-–]|to)\\s*('+numberPattern+'))?\\s*(?:\\+|plus)?\\s*(years?|yrs?|months?)\\b','ig');
export const numberValue=v=>numbers[normalize(v)]??Number(v);
export function durations(text){
 const explicit=[...String(text).matchAll(new RegExp(durationPattern))].map(m=>({start:m.index,end:m.index+m[0].length,quote:m[0],months:numberValue(m[1])*(/^m/i.test(m[3])?1:12),maximumMonths:numberValue(m[2]||m[1])*(/^m/i.test(m[3])?1:12)}));
 for(const m of String(text).matchAll(/\bhalf a decade\b/ig))explicit.push({start:m.index,end:m.index+m[0].length,quote:m[0],months:60,maximumMonths:60});
 return explicit.sort((a,b)=>a.start-b.start);
}
export function quantities(text){
 const values=[];
 const count=new RegExp('\\b('+numberPattern+'|\\d[\\d,]*)\\s*(?:(?:software|platform|clinical|senior|junior)\\s+)?(?:[- ](?:person|member)|people|staff|employees|engineers|direct reports|team members|patients|accounts|sites|users|orders)\\b','ig');
 for(const m of String(text).matchAll(count)){
  const unit=/people|staff|employees|engineers|direct reports|team members|person|member/i.test(m[0])?'people':m[0].match(/patients|accounts|sites|users|orders/i)[0].toLowerCase();
  values.push({amount:numberValue(m[1].replaceAll(',','')),unit,quote:m[0]});
 }
 for(const m of String(text).matchAll(new RegExp('\\bteam of\\s+('+numberPattern+')\\b','ig')))values.push({amount:numberValue(m[1]),unit:'people',quote:m[0]});
 for(const m of String(text).matchAll(/([$£€])\s*(\d[\d,]*(?:\.\d+)?)\s*(billion|million|thousand|bn|m|k)?\b/ig))values.push({amount:Number(m[2].replaceAll(',',''))*({billion:1e9,bn:1e9,million:1e6,m:1e6,thousand:1e3,k:1e3}[m[3]?.toLowerCase()]||1),unit:m[1],quote:m[0]});
 return values;
}
const requirementWording=/\b(?:required|preferred|must (?:have|hold)|candidates? (?:should|must)|job (?:description|requires?))\b/i;
const actionWords=evidenceActionPattern;
export const matchQualificationEvidence=interpretEvidence;
export const termPattern=term=>new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escapeRE(normalize(term))}(?=$|[^\\p{L}\\p{N}_])`,'u');
const originalEvidence=(p,fields={})=>({sourceId:p.sourceId,quote:p.quote,type:'direct',...fields});

// Use the existing date parser and interval union. Work dates are not silently
// converted into years using every tool mentioned in the role.
export function qualificationProfile(passages,asOf){
 const date=new Date(asOf||Date.now());if(Number.isNaN(date.getTime()))throw Error('invalid_assessment_date');
 const episodes=[],preceding=[];let episode=null,section='work';
 for(const p of passages){
  if(/^(education(?: and certifications)?|qualifications|certifications?|licen[cs]es?|professional credentials)\s*:?$/i.test(p.quote)){section='credentials';episode=null;}
  if(/^(skills|technical skills|technologies|tools|interests|references)\s*:?$/i.test(p.quote)){section='list';episode=null;}
  if(/^(?:(?:work|professional|employment|relevant|consulting|project)\s+(?:history|experience|engagements|projects)|experience|employment)\s*:?$/i.test(p.quote)){section='work';episode=null;}
  const dates=section==='work'?interval(p.quote,date):null;
  if(dates){
   const adjacent=[];
   for(const prior of preceding.slice(-2).reverse()){
    if(prior.section!=='work'||interval(prior.quote,date)||prior.quote.length>160||/[.!?]$/.test(prior.quote))break;
    const title=titleFamilies.some(names=>names.some(t=>hasTerm(prior.quote,t)));
    if(title){adjacent.push(prior);break;}
    if(new RegExp(actionWords.source,'i').test(prior.quote))break;
   }
   episode={id:'work-'+(episodes.length+1),...dates,header:p,titlePassages:adjacent,passages:[]};episodes.push(episode);
  }
  p.episodeId=episode?.id||null;p.section=section;
  if(episode)episode.passages.push(p);
  preceding.push(p);
 }
 return {asOf:date.toISOString().slice(0,10),passages,episodes};
}
function checkTerms(terms){if(!Array.isArray(terms)||terms.length>40||terms.some(t=>typeof t!=='string'||!t.trim()||t.length>140))throw Error('invalid_qualification_terms');}
export function validateQualification(node){
 const keys=['experience','credential','depth','workflow','recency','quantity','unresolved'].filter(k=>Object.hasOwn(node,k));
 if(keys.length!==1)throw Error('invalid_qualification');const kind=keys[0],q=node[kind];
 if(!q||typeof q!=='object')throw Error('invalid_qualification');
 if(kind==='experience'){
  if(!Number.isFinite(q.months)||q.months<=0||q.months>720||!['skill','occupation','general'].includes(q.kind))throw Error('invalid_experience_requirement');
  checkTerms(q.terms);checkTerms(q.titles||[]);
 }else if(kind==='recency'){
  checkTerms(q.terms);if(!q.terms.length||!Number.isFinite(q.months)||q.months<=0||q.months>600)throw Error('invalid_recency_requirement');
 }else if(kind==='quantity'){
  checkTerms(q.terms||[]);if(q.activity&&q.activity!=='people_management')throw Error('invalid_quantity_activity');if(!Number.isFinite(q.amount)||q.amount<=0||q.amount>1e15||!['people','patients','accounts','sites','users','orders','$','£','€'].includes(q.unit))throw Error('invalid_quantity_requirement');
 }else if(kind==='credential'){
  checkTerms(q.terms);checkTerms(q.fieldTerms||[]);checkTerms(q.jurisdiction||[]);
  if(!q.terms.length||typeof q.current!=='boolean')throw Error('invalid_credential_requirement');
 }else if(kind==='depth'){
  checkTerms(q.terms||[]);
  if(!['practice','implementation','ownership','people_management','senior','team_delivery','enterprise'].includes(q.level))throw Error('invalid_depth_requirement');
 }else if(kind==='workflow'){
  if(!capabilityWorkflows.some(w=>w.key===q.key))throw Error('invalid_workflow');
 }else if(typeof q.reason!=='string'||q.reason.length>240)throw Error('invalid_unresolved_requirement');
 return structuredClone(node);
}
const finding=(value,status,evidence=[],extra={})=>({value,status,evidence,...extra});
function matches(p,terms){return terms.map(t=>matchQualificationEvidence(termPattern(t),p)).filter(Boolean);}
function candidateFacts(profile,terms){return profile.passages.map(p=>({p,m:terms.length?matches(p,terms):[matchQualificationEvidence(new RegExp(actionWords.source,'i'),p)].filter(Boolean)})).filter(r=>r.m.some(m=>m.actor==='applicant'&&m.modality==='asserted'));}
function experienceFinding(q,profile){
 const evidence=[],claims=[];let denied=false;
 for(const {p,m} of candidateFacts(profile,q.terms)){
  if(m.every(x=>x.negative)){denied=true;evidence.push(originalEvidence(p,{type:'contradicted',value:0}));continue;}
  const ds=durations(p.quote);if(!ds.length||requirementWording.test(p.quote))continue;
  if(/\b(?:studying|learning|course|degree|training|planned|hoping|goal|requires?|seeking|looking for|will have|would have|expect to|expected to|by next|hope to)\b/i.test(p.quote))continue;
  for(const d of ds){
   // A number must belong to this capability, not an earlier unrelated clause.
   const local=p.quote.slice(d.end).split(/[,;]|\b(?:but|while)\b|\band\s+(?=(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:years?|months?))/i)[0];
   const prefix=p.quote.slice(0,d.start).split(/[,;]|\b(?:and|but|while)\b/i).at(-1)||'';
   if(q.kind!=='general'&&!q.terms.some(t=>hasTerm(local,t)||hasTerm(prefix,t)))continue;
   if(q.kind==='general'&&!/\b(professional|work|industry|career|employment)\b/i.test(p.quote))continue;
   const upperOnly=/\b(?:less than|under|up to|at most)\s*$/i.test(p.quote.slice(0,d.start));
   claims.push({months:d.months,maximum:d.maximumMonths,upperOnly,p});
   evidence.push(originalEvidence(p,{months:d.months,maximumMonths:d.maximumMonths,basis:'explicit_duration_claim'}));
  }
 }
 const direct=claims.filter(c=>!c.upperOnly),best=direct.sort((a,b)=>b.months-a.months)[0];
 const short=claims.some(c=>(c.upperOnly?c.maximum:c.maximum)<q.months&&/\b(?:only|total|overall|entire|less than|under|at most)\b/i.test(c.p.quote));
 if(best?.months>=q.months&&!short&&!denied)return finding(1,'supported',evidence,{months:best.months,basis:'resume_claim',verificationRequired:true});
 const relevant=[];
 if(q.kind!=='skill')for(const e of profile.episodes){
  const titleMatch=q.kind==='general'||[e.header,...(e.titlePassages||[])].some(p=>q.titles.some(t=>hasTerm(p.quote,t)));
  const practice=e.passages.some(p=>q.kind==='general'?candidateFacts({passages:[p]},[]).some(r=>r.m.some(m=>m.substantive&&!m.negative)):candidateFacts({passages:[p]},q.terms).some(r=>r.m.some(m=>m.substantive&&!m.negative)));
  if(titleMatch&&practice)relevant.push(e);
 }
 // For exact tools, only an explicitly dated activity establishes a period.
 if(q.kind==='skill')for(const p of profile.passages){
  const span=interval(p.quote,new Date(profile.asOf));
  if(span&&matches(p,q.terms).some(m=>m.substantive&&!m.negative))relevant.push({...span,header:p});
 }
 const ambiguousRole=e=>[e.header,...(e.titlePassages||[])].some(p=>/\b(other|various|multiple) roles\b/i.test(p.quote));
 const precise=relevant.filter(e=>e.precision==='month'&&!ambiguousRole(e)),documented=unionMonths([...precise]);
 for(const e of relevant){
  for(const p of e.titlePassages||[])evidence.push(originalEvidence(p,{basis:'adjacent_role_title'}));
  evidence.push(originalEvidence(e.header,{basis:ambiguousRole(e)?'ambiguous_role_duration':e.precision==='month'?'documented_relevant_period':'partial_dates',startMonth:e.start_month,endMonth:e.end_month}));
  for(const p of (e.passages||[]).filter(p=>candidateFacts({passages:[p]},q.terms).some(r=>r.m.some(m=>m.substantive&&!m.negative))).slice(0,2))evidence.push(originalEvidence(p,{basis:'relevant_work_in_period'}));
 }
 if(documented>=q.months&&!short&&!denied)return finding(1,'supported',evidence,{months:documented,basis:'documented_relevant_periods',verificationRequired:true});
 if(short||denied)return finding(best||documented?0.35:0,'contradicted',evidence,{months:best?.months||documented||null,verificationRequired:true});
 return finding(evidence.length?Math.min(0.7,(best?.months||documented||0)/q.months):0,evidence.length?'partial':'unknown',evidence,{months:best?.months||documented||null,verificationRequired:true});
}
function credentialFinding(q,profile){
 const rows=candidateFacts(profile,q.terms),evidence=[],events=[];let value=0,contradicted=false,pending=false;
 for(const {p,m} of rows){
  if(requirementWording.test(p.quote))continue;
  if(q.fieldTerms?.length&&!q.fieldTerms.some(t=>hasTerm(p.quote,t)))continue;
  if(/\b(?:worked with|alongside|supported|supervised|managed|trained)\b.{0,35}\b(?:CPAs?|RNs?|nurses?|teachers?)\b/i.test(p.quote))continue;
  const scope=q.jurisdiction?.length?q.jurisdiction.some(t=>t.length===2?new RegExp('\\b'+escapeRE(t.toUpperCase())+'\\b').test(p.quote):hasTerm(p.quote,t)):true;
  const expiry=p.quote.match(/\b(?:expires?|expiration|valid (?:through|until))\s*:?\s*((?:20\d{2}-\d{2}-\d{2})|(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(?:\d{1,2},?\s+)?20\d{2})|20\d{2})/i);
  let expired=false,datedCurrent=false;
  if(expiry){
   const raw=expiry[1],parsed=Date.parse(raw);
   if(Number.isFinite(parsed)){
    // A month/year-only expiry is uncertain within that period; do not invent a day.
    const dateOnly=/^\d{4}-\d{2}-\d{2}$/.test(raw),yearOnly=/^\d{4}$/.test(raw),monthOnly=/^[a-z]+\s+\d{4}$/i.test(raw);
    const end=yearOnly?Date.UTC(Number(raw),11,31):monthOnly?new Date(new Date(parsed).getUTCFullYear(),new Date(parsed).getUTCMonth()+1,0).getTime():parsed;
    expired=end<Date.parse(profile.asOf);datedCurrent=dateOnly?parsed>=Date.parse(profile.asOf):parsed>Date.parse(profile.asOf);
   }
  }
  const negative=m.every(x=>x.negative)||expired||/\b(expired|revoked|suspended|inactive|unlicensed|not certified|not licensed)\b/i.test(p.quote);
  const studying=/\b(pending|candidate for|studying|pursuing|in progress|scheduled|prepar(?:ing|ation)|coursework|training course|eligible|exam prep|(?:will|intend to|plan to|expect to) (?:earn|obtain|complete|receive)|working toward)\b/i.test(p.quote);
  const claimed=p.section==='credentials'||/\b(certifi\w*|licen[cs]\w*|holds?|earned|awarded|completed|bachelor\w*|master\w*|doctor\w*|degree|diploma|BSc|BA|BS|MSc|MBA|MS|PhD|current|active|valid)\b/i.test(p.quote);
  const current=/\b(current|active|valid|renewed)\b/i.test(p.quote)||datedCurrent;
  let v=negative?0:!claimed||studying||!scope||q.current&&!current?0.35:1;
  const event=p.quote.match(/\b(renewed|reinstated|expired|revoked|suspended)\s+((?:20\d{2}-\d{2}-\d{2})|(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(?:\d{1,2},?\s+)?20\d{2})|20\d{2})/i);
  const eventTime=event?Date.parse(event[2]):NaN;
  const rawEvent=event?.[2]||'',eventEnd=/^\d{4}$/.test(rawEvent)?Date.UTC(Number(rawEvent),11,31):
   /^[a-z]+\s+\d{4}$/i.test(rawEvent)?Date.UTC(new Date(eventTime).getUTCFullYear(),new Date(eventTime).getUTCMonth()+1,0):eventTime;
  const futureEvent=Number.isFinite(eventTime)&&eventTime>Date.parse(profile.asOf);
  if(futureEvent)v=Math.min(v,0.35);
  pending||=studying||futureEvent;value=Math.max(value,v);
  events.push({negative,time:eventTime,end:eventEnd,renewal:scope&&!studying&&!negative&&!futureEvent&&/^(renewed|reinstated)$/i.test(event?.[1]||''),sourceId:p.sourceId,scope});
  evidence.push(originalEvidence(p,{type:negative?'contradicted':'direct',value:v,credentialClaim:true,verificationRequired:true,...(expiry?{expiryText:expiry[0]}:{})}));
 }
 // Only a dated later renewal of the required credential/jurisdiction resolves
 // an older invalidity. Undated conflicts and later revocations stay unresolved.
 for(const event of events.filter(e=>e.negative)){
  const renewal=Number.isFinite(event.end)&&event.scope&&events.find(e=>e.renewal&&e.time>event.end);
  if(renewal){
   const item=evidence.find(e=>e.sourceId===event.sourceId);
   item.type='historical';item.supersededBy=renewal.sourceId;
  }else contradicted=true;
 }
 if(contradicted)value=Math.min(value,0.35);
 return finding(value,contradicted?'contradicted':value===1?'supported':evidence.length?'partial':'unknown',evidence,{verificationRequired:true,independentlyVerified:false,...(pending?{pending:true}:{})});
}
function depthFinding(q,profile){
 const evidence=[];let value=0,negative=false;
 for(const {p,m} of candidateFacts(profile,q.terms||[])){
  const matches=m.filter(x=>!x.negative&&x.actor==='applicant'),depth=matches.find(x=>x.substantive)?.depth||matches.find(x=>x.depth)?.depth;
  if(!matches.length){negative=true;evidence.push(originalEvidence(p,{type:'contradicted',value:0}));continue;}
  const practice=matches.some(x=>x.substantive),team=/\b(collaborat\w*|partnered|alongside|with (?:the |a )?team|coordinated with)\b/i.test(p.quote);
  const people=/\b(?:manage[ds]?|managing|supervise[ds]?|supervising|led|leads?)\s+(?:(?:a|the)\s+)?(?:team|staff|people|employees|direct reports)\b|\b(?:hired|coached|mentored)\b.{0,50}\b(?:engineers|staff|employees|team|teachers|nurses)\b|\bperformance reviews\b/i.test(p.quote)||
   matches.some(m=>/^(manage[ds]?|managing|supervise[ds]?|supervising|led|leads?)$/.test(m.action||'')&&quantities(m.clause).some(n=>n.unit==='people'));
  const ownership=practice&&(depth==='ownership'||/\b(accountable|owned|architected|decision|design authority)\b/i.test(p.quote));
  const implemented=practice&&(depth==='implementation'||/\b(implemented|designed|developed|built|migrated|configured|architected)\b/i.test(p.quote));
  const sufficient={practice,implementation:implemented,ownership,people_management:people&&practice,team_delivery:team&&(practice||depth==='contribution'),senior:(ownership||implemented)&&/\b(architect\w*|design\w*|led|owned|mentor\w*|complex|production|standards|decisions|enterprise)\b/i.test(p.quote),enterprise:practice&&/\b(enterprise|organization-wide|multi-site|multiple sites|company-wide|global)\b/i.test(p.quote)}[q.level];
  const v=sufficient?1:practice||team?0.5:0.2;value=Math.max(value,v);
  evidence.push(originalEvidence(p,{depth:depth||'mention',value:v}));
 }
 if(negative)value=Math.min(value,0.35);
 return finding(value,negative?'contradicted':value===1?'supported':evidence.length?'partial':'unknown',evidence.sort((a,b)=>b.value-a.value).slice(0,8));
}
function workflowFinding(q,profile){
 const workflow=capabilityWorkflows.find(w=>w.key===q.key),groups=new Map();
 for(const p of profile.passages){
  // Without a work/project boundary the resume is one undated context, and
  // inferred connected work is capped at partial rather than asserted complete.
  const group=p.episodeId||'undated';
  for(const [stage,pattern] of workflow.phases){
   const match=matchQualificationEvidence(new RegExp('\\b(?:'+pattern+')','i'),p);
   if(!match?.substantive||match.negative)continue;
   if(!groups.has(group))groups.set(group,new Map());groups.get(group).set(stage,p);
  }
 }
 const [group,stages]=[...groups].sort((a,b)=>b[1].size-a[1].size)[0]||['',new Map()];
 const distinct=new Set([...stages.values()].map(p=>p.sourceId));
 const complete=group!=='undated'&&stages.size===workflow.phases.length&&distinct.size>=2;
 return finding(complete?1:stages.size>=2?0.5:stages.size?0.2:0,complete?'supported':stages.size?'partial':'unknown',
  [...new Map([...stages.values()].map(p=>[p.sourceId,originalEvidence(p,{type:complete?'direct':'inferred'})])).values()],
  {workflow:q.key,phases:[...stages.keys()],missingPhases:workflow.phases.map(([key])=>key).filter(key=>!stages.has(key))});
}
function recencyFinding(q,profile){
 const date=new Date(profile.asOf),now=date.getUTCFullYear()*12+date.getUTCMonth(),cutoff=now-q.months,evidence=[];let value=0,denied=false;
 for(const {p,m} of candidateFacts(profile,q.terms)){
  if(m.every(m=>m.negative)){denied=true;evidence.push(originalEvidence(p,{type:'contradicted'}));continue;}
  if(!m.some(m=>m.substantive))continue;
  const span=interval(p.quote,date)||profile.episodes.find(e=>e.id===p.episodeId);
  const statedYear=p.quote.match(/\b(?:in|during|since|until|last used.*?in)\s+(20\d{2})\b/i),year=statedYear?Number(statedYear[1])*12:null;
  const inside=span?span.start_month>=cutoff:year!==null&&year>=cutoff&&year<=now;
  const stale=span?span.end_month<=cutoff:year!==null&&year+12<=cutoff;
  const v=inside?1:span||year!==null?0.35:0;value=Math.max(value,v);
  if(stale&&/\blast\b/i.test(p.quote))denied=true;
  if(v||stale){evidence.push(originalEvidence(p,{value:v,basis:inside?'activity_within_window':'uncertain_or_older_period'}));if(span?.header&&span.header!==p)evidence.push(originalEvidence(span.header,{basis:'work_period'}));}
 }
 if(denied)value=Math.min(value,0.35);
 return finding(value,denied?'contradicted':value===1?'supported':evidence.length?'partial':'unknown',evidence,{windowMonths:q.months,asOf:profile.asOf});
}
function quantityFinding(q,profile){
 const evidence=[];let value=0,denied=false;
 for(const p of profile.passages)for(const quote of p.quote.split(new RegExp('\\s+(?:and|while)\\s+(?=(?:I|we|my|our|the|their|he|she|they)\\b|'+actionWords.source+')','i'))){
  const inheritedActor=interpretEvidence(new RegExp(escapeRE(normalize(quote)),'i'),p)?.actor;
  const local={...p,quote,normalized:normalize(quote),inheritedActor},found=quantities(quote).filter(m=>m.unit===q.unit);
  if(!found.length)continue;
  const m=candidateFacts({passages:[local]},q.terms||[])[0]?.m||[];
  if(m.length&&m.every(m=>m.negative)){denied=true;evidence.push(originalEvidence(p,{type:'contradicted',value:0}));continue;}
  if(!m.some(m=>m.substantive&&!m.negative))continue;
  if(q.activity==='people_management'&&!/\b(manage[ds]?|managing|supervise[ds]?|supervising|led|leads?)\b.{0,45}\b(team|people|staff|employees|engineers|direct reports)\b/i.test(quote))continue;
  const amount=Math.max(...found.map(x=>x.amount)),negative=/\b(no|never|not|only)\b/i.test(quote)&&amount<q.amount;
  const v=negative?0:Math.min(1,amount/q.amount);value=Math.max(value,v);denied||=negative;
  evidence.push(originalEvidence(p,{type:negative?'contradicted':'direct',amount,unit:q.unit,value:v}));
 }
 if(denied)value=Math.min(value,0.35);
 return finding(value,denied?'contradicted':value===1?'supported':evidence.length?'partial':'unknown',evidence);
}
export function evaluateQualification(node,profile){
 if(node.experience)return experienceFinding(node.experience,profile);
 if(node.credential)return credentialFinding(node.credential,profile);
 if(node.depth)return depthFinding(node.depth,profile);
 if(node.workflow)return workflowFinding(node.workflow,profile);
 if(node.recency)return recencyFinding(node.recency,profile);
 if(node.quantity)return quantityFinding(node.quantity,profile);
 return finding(0,'unknown',[],{unresolved:node.unresolved.reason});
}
