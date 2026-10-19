import {isSourceInstruction} from './source-instructions.mjs';
import {normalize,hasTerm,recognizedCapabilities,capabilityCondition,equivalentTitles,titleFamilies,credentialFamilies,workflowFor} from './screening-vocabulary.mjs';
import {durations,quantities} from './screening-qualifications.mjs';
import {unsafeScreeningText} from './screening-rule-spec.mjs';

export const requirementsVersion='job-requirements-v2';
const distinct=values=>[...new Set(values)];
const all=nodes=>nodes.length===1?nodes[0]:{all:nodes};
const any=nodes=>nodes.length===1?nodes[0]:{any:nodes};
const protectedText=/\b(age|birth|marital|religio\w*|nationality|gender|ethnic\w*|racial|pregnan\w*|sexual orientation|citizenship|postal code|zip code|graduation year|native speaker|young|male|female|disab\w*)\b/i;
export const excludedRequirement=text=>protectedText.test(text)||unsafeScreeningText(text)||isSourceInstruction(text);
export function requirementClauses(text){
 return String(text||'').split(/\n+|(?<=[.!?;])\s+|\s*;\s*/).map(s=>s.replace(/^\s*[-•*]+\s*/,'').trim()).filter(Boolean);
}
const notRequired=text=>/\b(not required|not mandatory|not necessary|no longer required|no requirement)\b|\bno\b(?:(?!\b(?:but|and|however|although)\b)[^.!?;]){1,100}\b(?:is|are) required\b/i.test(text);
export function requirementType(text,fallback='inferred'){
 if(/\b(preferred|prefers?|preferably|nice.to.have|bonus|optional|a plus)\b/i.test(text))return 'preferred';
 if(notRequired(text))return 'inferred';
 if(/\b(must|required|requires?|mandatory|minimum|essential|at least)\b/i.test(text))return 'required';
 return fallback;
}
const stop=new Set(('a an and or as at be been being by can candidate candidates capability capabilities company core could deliver delivery desired duties experience experienced for from have has having in into is it job knowledge looking may minimum must need needs of on our preferred preferably qualification qualifications required requirement requirements responsibility responsibilities role should skill skills strong team teams the their this to using we with work working years year months month you your ability proven demonstrated hands hands-on senior lead leading own owning build building design designing implement implementing manage managing develop developing perform performing relevant extensive solid deep understanding good excellent top priority priorities more most matters important highly rather than only least manager wants want really seeking five four three two one ten eight seven six nine twenty plus current active certification license degree equivalent independently independent enterprise').split(' '));
for(const verb of 'maintain operate restore repair inspect assess teach train prepare process administer reconcile coordinate negotiate source screen analyze monitor resolve document track verify plan schedule facilitate measure reduce increase create reproduce validate diagnose calibrate receive pick pack'.split(' '))stop.add(verb);
function genericGroups(text){
 const words=normalize(text).replace(/\d+(?:\.\d+)?/g,' ').replace(/[^\p{L}\p{N}+#/ -]/gu,' ').split(/\s+/)
  .filter(w=>w.length>=3&&!stop.has(w)&&!['years','months','yrs','degree','degrees'].includes(w));
 return distinct(words).slice(0,6).map(word=>({terms:[word,...(word.endsWith('s')&&word.length>4?[word.slice(0,-1)]:[])],related:[]}));
}
function capabilityGroups(text,spec){
 if(spec?.groups?.length)return spec.groups.map(g=>any(g.alternatives.map(capabilityCondition)));
 const recognized=recognizedCapabilities(text);
 if(!recognized.length)return genericGroups(text);
 const groups=[];let last=null;
 for(const item of recognized){
  const at=normalize(text).indexOf(item.match),between=last?normalize(text).slice(last.at+last.match.length,at):'';
  const c=capabilityCondition(item.term);
  if(last&&/^\s*(?:,?\s*(?:or|and\/or)|\/)\s*$/i.test(between)){
   const previous=groups.pop();groups.push({any:[...(previous.any||[previous]),c]});
  }else groups.push(c);
  last={...item,at};
 }
 return groups;
}
function termList(condition){
 if(condition.terms)return condition.terms;
 if(condition.credential)return condition.credential.terms;
 if(condition.experience)return condition.experience.terms;
 return (condition.all||condition.any||[]).flatMap(termList);
}
const occupationActivities=[
 ['software engineer',['software','application','applications','code','coding','api','apis','services','software development','software engineering','backend','frontend','interfaces','interface','endpoints','integrations','etl pipelines','portals','test suite']],
 ['cloud engineer',['cloud','azure','aws','infrastructure','platform']],
 ['qa engineer',['testing','tests','test','defects','regression']],
 ['application security engineer',['security','sast','dast','vulnerabilities','threat modeling']],
 ['accountant',['accounts','reconciliation','reconciled','ledger','financial','journal entries']],
 ['registered nurse',['patients','patient','medications','care','nursing']],
 ['teacher',['students','student','classroom','curriculum','lesson','lessons']],
 ['maintenance technician',['equipment','machines','machinery','motors','maintenance']],
 ['warehouse associate',['orders','inventory','shipments','stock','warehouse']],
 ['recruiter',['candidates','candidate','recruiting','recruitment','interviews']],
 ['account executive',['sales','deals','prospects','customers']],['account manager',['accounts','customers','renewals']],
 ['executive assistant',['calendars','travel','meetings','executive']],['marketing manager',['campaigns','marketing','audience']]
];
function occupation(text,jobTitle){
 const family=titleFamilies.find(names=>names.some(n=>hasTerm(text,n)))||(/\b(software (?:engineering|development)|application development)\b/i.test(text)?titleFamilies[0]:null);
 if(family)return {titles:family,terms:occupationActivities.find(([key])=>family.includes(key))?.[1]||family};
 // "relevant experience" refers to this job's work, not every year employed.
 if(/\b(relevant|professional|industry)\s+(?:work\s+)?experience\b/i.test(text)){
  const titles=equivalentTitles(jobTitle),terms=occupationActivities.find(([key])=>titles.includes(key))?.[1];
  if(terms)return {titles,terms};
 }
 return null;
}
function jurisdiction(text){
 const states='Alabama:AL|Alaska:AK|Arizona:AZ|Arkansas:AR|California:CA|Colorado:CO|Connecticut:CT|Delaware:DE|Florida:FL|Georgia:GA|Hawaii:HI|Idaho:ID|Illinois:IL|Indiana:IN|Iowa:IA|Kansas:KS|Kentucky:KY|Louisiana:LA|Maine:ME|Maryland:MD|Massachusetts:MA|Michigan:MI|Minnesota:MN|Mississippi:MS|Missouri:MO|Montana:MT|Nebraska:NE|Nevada:NV|New Hampshire:NH|New Jersey:NJ|New Mexico:NM|New York:NY|North Carolina:NC|North Dakota:ND|Ohio:OH|Oklahoma:OK|Oregon:OR|Pennsylvania:PA|Rhode Island:RI|South Carolina:SC|South Dakota:SD|Tennessee:TN|Texas:TX|Utah:UT|Vermont:VT|Virginia:VA|Washington:WA|West Virginia:WV|Wisconsin:WI|Wyoming:WY|District of Columbia:DC|Puerto Rico:PR|Ontario:ON|Quebec:QC|Alberta:AB|British Columbia:BC';
 const places=states.split('|').map(s=>s.split(':')),known=places.find(names=>hasTerm(text,names[0]));
 if(known)return known.map(normalize);
 const abbreviated=places.find(([,code])=>new RegExp('\\b'+code+'(?=\\s+(?:RN|LPN|nursing|teaching|medical|license|licence|registration)\\b)|\\b(?:in|for)\\s+'+code+'\\b').test(text));
 if(abbreviated)return abbreviated.map(normalize);
 // Preserve explicit unfamiliar regions as exact source terms instead of
 // assuming that an unrelated jurisdiction satisfies the requirement.
 const suffix=text.match(/\b(?:license|licence|registration)\s+(?:(?:required|valid|active|current)\s+)?(?:in|for)\s+(?:the state of\s+)?([a-z ]+?)(?=\s+(?:is|required|preferred|and|or)\b|[.!;,]|$)/i)?.[1];
 const prefix=text.match(/\b(?:active|current|valid)\s+([a-z ]+?)\s+(?:RN|LPN|nursing|teaching|medical)\s+(?:license|licence|registration)\b/i)?.[1];
 return suffix||prefix?[normalize(suffix||prefix)]:[];
}
function credentials(text){
 const found=[];
 for(const names of credentialFamilies){
  if(!names.some(n=>hasTerm(text,n)))continue;
  const local=text.split(/\s+(?:and|or)\s+|,\s*/i).find(part=>names.some(n=>hasTerm(part,n)))||text;
  if(['rn','lpn'].includes(names[0])&&!/\b(license|licence|licensed|active|current|valid|registration)\b/i.test(local)&&!/^\s*(?:RN|LPN|registered nurse)\s+(?:required|preferred)[.!]?$/i.test(local))continue;
  const bareRole=['rn','registered nurse','lpn'].includes(normalize(text).replace(/[.!]$/,''));
  if(bareRole)continue;
  // Specific certificates do not become broad technology equivalents.
  let terms=names;
  if(names[0]==='azure certification'){
   if(/az-305|azure solutions architect expert/i.test(text))terms=['az-305','azure solutions architect expert'];
   else if(/az-104|azure administrator associate/i.test(text))terms=['az-104','azure administrator associate'];
  }
  found.push({credential:{terms,current:/\b(active|current|valid|unexpired)\b/i.test(local),jurisdiction:jurisdiction(local),fieldTerms:[]}});
 }
 const degree=text.match(/\b(bachelor(?:[’']s)?|master(?:[’']s)?|doctorate|doctoral|ph\.?d\.?|associate(?:[’']s)?|diploma|BSc|MSc|MBA|BS|BA|MS)\b/i);
 if(degree){
  const word=normalize(degree[1]),level=/^(master|msc|mba|ms)/.test(word)?'masters':/^(doctor|ph)/.test(word)?'doctorate':/^associate|diploma/.test(word)?'associate':'bachelors';
  const byLevel={bachelors:['bachelor','bachelors',"bachelor's",'bachelor’s','bsc','b.sc.','b.s.','bs','ba','b.a.'],masters:['master','masters',"master's",'master’s','msc','m.sc.','m.s.','ms','mba'],doctorate:['doctorate','doctoral','phd','ph.d.'],associate:['associate',"associate's",'associate’s','diploma']};
  const field=text.match(/\b(?:degree|bachelor(?:[’']s)?|master(?:[’']s)?|BSc|BS|BA|MSc|MS)\s+(?:degree\s+)?in\s+([^,;.]+?)(?=\s+(?:is |required|preferred|or\b)|[,;.]|$)/i)?.[1]?.trim();
  found.push({credential:{terms:byLevel[level],current:false,jurisdiction:[],fieldTerms:field?[normalize(field)]:[],level}});
 }
 // Open-text licenses/certificates remain supported without an occupation list.
 if(!found.length&&/\b(license|licence|certification|certificate)\b/i.test(text)){
  const name=text.replace(/\b(must|have|hold|holds|an?|the|active|current|valid|is|required|preferred|mandatory|essential)\b/ig,' ').replace(/[.!]/g,'').replace(/\s+/g,' ').trim();
  if(name.length>=4&&name.length<=100&&!/^(license|licence|certificate|certification)$/i.test(name))found.push({credential:{terms:[normalize(name)],current:/\b(active|current|valid)\b/i.test(text),jurisdiction:jurisdiction(text),fieldTerms:[]}});
 }
 return found;
}
function depthFor(text){
 if(/\b(?:no|not|without|does not|do not|will not)\b.{0,35}\b(?:sole|independent|own|ownership|supervis|manage)/i.test(text))return null;
 if(/\b(manage|supervise|lead)\b.{0,20}\b(team|staff|people|employees|direct reports)\b|\bpeople management\b/i.test(text))return 'people_management';
 if(/\b(own|ownership|independent|independently|sole|accountable|leadership)\b/i.test(text))return 'ownership';
 if(/\b(senior|advanced)\b/i.test(text))return 'senior';
 if(/\b(design|build|implement|develop|configure|migrate|architecture)\b/i.test(text))return 'implementation';
 if(/\b(hands-on|hands on|practical|practice|perform|operate|maintain|restore|repair|inspect|assess|teach|train|reconcile|administer|reproduce|validate|diagnose|calibrate|pick|pack|receive)\b/i.test(text))return 'practice';
 return null;
}
function relevantSource(title,quote){
 const clauses=requirementClauses(quote);if(clauses.length<=1)return quote;
 const words=distinct(normalize(title).split(/[^\p{L}\p{N}+#]+/u).filter(w=>w.length>2&&!stop.has(w)));
 const scored=clauses.map(text=>({text,score:words.filter(w=>hasTerm(text,w)).length}));
 const max=Math.max(...scored.map(r=>r.score));
 return max?scored.filter(r=>r.score===max).map(r=>r.text).join(' '):title;
}

// Inputs are canonical server records, never applicant data. Every generated
// condition retains its source and says when language could not be represented.
export function compileRequirement({id,title,sourceQuote=title,requirementType:kind='inferred',weight=1,origin='job',spec,jobTitle='',question=''}){
 const source=origin==='recruiter'?sourceQuote:relevantSource(title,sourceQuote),type=requirementType(source,kind);
 if(excludedRequirement(title)||excludedRequirement(source))return {excluded:true,id,title,sourceQuote:source,reason:'non_job_related_or_instruction'};
 if(notRequired(source)&&!/(preferred|optional|nice.to.have)/i.test(source))return {excluded:true,id,title,sourceQuote:source,reason:'explicitly_not_required'};
 const allDurations=durations(source),recent=allDurations.find(d=>/\b(?:past|last|within)\s*(?:the\s*)?$/i.test(source.slice(0,d.start))),
  ds=allDurations.filter(d=>d!==recent&&(/\b(experience|experienced|background|practice|working|using)\b/i.test(source)||/\b(minimum|at least|required|mandatory)\b/i.test(source)&&recognizedCapabilities(source).length)),
  creds=credentials(source),role=occupation(source,jobTitle),workflow=workflowFor(title);
 const numeric=ds[0];
 const recognized=recognizedCapabilities(source).map(x=>x.term),scopeText=role?role.terms:recognized.length?recognized:numeric?genericGroups(source.slice(numeric.end)).flatMap(termList):[];
 const durationNodes=ds.map((d,index)=>{
  const segment=source.slice(d.end,ds[index+1]?.start||source.length).replace(/\b(?:and|or)\s*$/i,'').trim();
  const localRole=occupation(segment,jobTitle),caps=recognizedCapabilities(segment).map(x=>x.term);
  const localScope=localRole?.terms|| (caps.length?caps:genericGroups(segment).flatMap(termList));
  const yearNode=terms=>({experience:{months:d.months,kind:localRole?'occupation':terms.length?'skill':'general',terms:localRole?.terms||terms,titles:localRole?.titles||[]}});
  const groups=!localRole?capabilityGroups(segment).filter(g=>termList(g).some(t=>localScope.some(s=>hasTerm(t,s)||hasTerm(s,t)))):[];
  const experienceGroup=g=>g.any?any(g.any.map(experienceGroup)):yearNode(g.terms);
  return groups.length?all(groups.map(experienceGroup)):yearNode(localScope);
 });
 const years=durationNodes.length?(ds.length>1&&/\bor\s*$/i.test(source.slice(ds[0].end,ds[1].start))?any(durationNodes):all(durationNodes)):null;
 const measures=quantities(source);
 let baseText=numeric?source.slice(numeric.end):title;
 for(const q of measures.filter(q=>['$','£','€'].includes(q.unit)))baseText=baseText.replace(q.quote,'');
 let groups=capabilityGroups(baseText,spec);
 if(/\b(assist|support|contribute)\b/i.test(title)){
  const acceptsContribution=c=>c.terms?{...c,minimumDepth:'contribution'}:c.all?{all:c.all.map(acceptsContribution)}:{any:c.any.map(acceptsContribution)};
  groups=groups.map(acceptsContribution);
 }
 if(creds.length)groups=recognizedCapabilities(title).filter(x=>!creds.some(c=>c.credential.terms.some(t=>hasTerm(t,x.match)||hasTerm(x.match,t)))).map(x=>capabilityCondition(x.term));
 const nodes=[];
 if(recent&&scopeText.length)nodes.push({recency:{months:recent.months,terms:scopeText}});
 else if(/\brecent\b/i.test(source))nodes.push({unresolved:{reason:'The job asks for recent experience without defining a time window.'}});
 if(creds.length&&/\bor\b/i.test(source)&&(/\bequivalent (?:work )?experience\b/i.test(source)||years)){
  const alternative=years||{depth:{level:'practice',terms:occupation('relevant experience',jobTitle)?.terms||recognizedCapabilities(title).map(x=>x.term)}};
  nodes.push(any([...creds,alternative]));
 }else{
  if(creds.length)nodes.push(/\bor\b/i.test(source)?any(creds):all(creds));
  if(years)nodes.push(years);
 }
 // A duration condition already checks relevant substantive work. Do not demand
 // that a resume repeats a job's generic "X years of experience" phrase.
 if(!years&&groups.length)nodes.push(all(groups));
 if(workflow&&/\b(full.cycle|end.to.end|lifecycle|entire|complete)\b/i.test(title))nodes.push({workflow:{key:workflow.key}});
 const depth=depthFor(title)||depthFor(source);
 const terms=distinct(groups.flatMap(termList));
 for(const q of measures)nodes.push({quantity:{amount:q.amount,unit:q.unit,terms,...(q.unit==='people'&&depth==='people_management'?{activity:'people_management'}:{})}});
 let unparsedNumbers=source;
 for(const d of allDurations)unparsedNumbers=unparsedNumbers.replace(d.quote,'');
 for(const q of measures)unparsedNumbers=unparsedNumbers.replace(q.quote,'');
 if(/\d/.test(unparsedNumbers)&&!creds.length)nodes.push({unresolved:{reason:'This numerical scope or version needs evidence beyond the supported qualification rules.'}});
 if(depth&&(!creds.length||groups.length))nodes.push({depth:{level:depth,terms:terms.length?terms:role?.terms||scopeText}});
 if(/\benterprise\b/i.test(title)&&terms.length)nodes.push({depth:{level:'enterprise',terms}});
 if(!nodes.length)nodes.push({unresolved:{reason:'The job statement does not identify an assessable capability or qualification.'}});
 return {id,title,sourceQuote:source,requirementType:type,weight,origin,question,condition:all(nodes),capabilityTerms:terms,
  interpretation:years?'experience':creds.length?'credential':workflow?'workflow':'capability'};
}

function time(value){return typeof value==='number'?value:Date.parse(value);}
export function approvedManagerSources({feedback=[],assessments=[],lessons=[],job}){
 const sources=[],ignored=[];
 for(const f of feedback){
  if(f.workspace_id!==job.workspace_id||f.job_id!==job.id)continue;
  const rows=assessments.filter(a=>a.workspace_id===job.workspace_id&&a.job_id===job.id&&a.candidate_id===f.candidate_id&&a.assessment_type==='manager_feedback'&&a.evidence?.feedback_id===f.id).sort((a,b)=>time(b.created_at)-time(a.created_at)||String(b.id).localeCompare(String(a.id)));
  const e=rows[0]?.evidence;
  if(e?.learning_scope!=='job'||e?.signal_status!=='approved')continue;
  if(time(e.source_updated_at)!==time(f.updated_at)){ignored.push({sourceId:f.id,reason:'stale_preference'});continue;}
  if(typeof e.signal_label!=='string'||!e.signal_label.trim())continue;
  if(e.signal_direction==='negative'&&!/\b(needs?|requires?|must|lack\w*|missing|no |not enough|insufficient)\b/i.test(e.signal_label)){
   ignored.push({sourceId:f.id,reason:'ambiguous_negative_preference'});continue;
  }
  sources.push({id:'preference-'+f.id,text:e.signal_label.replace(/\b(lacks?|missing|insufficient|not enough|no)\s+/ig,''),quote:e.signal_label,kind:'approved_manager_preference'});
 }
 for(const l of lessons){
  if(l.automatic||!l.active||l.scope!=='job'||l.job_id!==job.id||l.kind!=='manager_priority'||typeof l.text!=='string')continue;
  sources.push({id:'lesson-'+l.id,text:l.text,quote:l.text,kind:'approved_manager_preference'});
 }
 return {sources,ignored};
}
export function compileJobRequirements({job,priorities,managerSources=[]}){
 const rules=[],excluded=[],issues=[],items=priorities.items||[],used=new Set(),editedOverrides=[];
 function add(input){
  const r=compileRequirement({...input,jobTitle:job.title});
  if(r.excluded){excluded.push(r);return;}
  const key=JSON.stringify([r.condition,r.requirementType]);if(used.has(key)&&!['priority','recruiter'].includes(input.origin))return;used.add(key);rules.push(r);
 }
 for(const [index,p] of items.entries()){
  const edited=p.source_kind==='recruiter'||priorities.review_status==='edited'||p.screening_rule&&(p.screening_rule.bound_title!==p.title||p.screening_rule.bound_reason!==p.reason||p.screening_rule.bound_question!==p.question);
  const revisedReason=edited?requirementClauses(p.reason).filter(text=>requirementType(text)!=='inferred'||durations(text).length):[];
  const source=edited?[p.title,...revisedReason].join(' '):p.source_quote;
  if(!source||(!edited&&!String(job.description||'').includes(source))){issues.push({priorityId:p.id,code:'unavailable_priority_source'});continue;}
  if(edited&&(durations(source).length||requirementType(source)!=='inferred'))editedOverrides.push({original:p.source_quote||'',source,terms:recognizedCapabilities(source).map(c=>c.term)});
  const spec=!edited?p.screening_rule:null;
  add({id:p.id,title:p.title,sourceQuote:source,requirementType:p.requirement_type,weight:items.length-index,origin:edited?'recruiter':'priority',question:p.question,spec});
 }
 // Explicit requirements outside the Top 5 remain visible and assessable.
 const extras=[...(job.criteria||[]).map((text,i)=>({id:'criterion-'+(i+1),text,kind:'inferred'})),...(job.knockouts||[]).map((text,i)=>({id:'mandatory-'+(i+1),text,kind:'required'}))];
 for(const [i,text] of requirementClauses(job.description).entries())if(requirementType(text)!=='inferred'||durations(text).length)extras.push({id:'job-requirement-'+(i+1),text,kind:requirementType(text)});
 for(const {id,text,kind} of extras){
  if(typeof text!=='string'||text.length>4000){issues.push({code:'invalid_additional_requirement',id});continue;}
  if(editedOverrides.some(o=>o.original.includes(text)&&(durations(text).length&&durations(o.source).length||normalize(text)===normalize(o.original))&&o.terms.some(t=>recognizedCapabilities(text).some(c=>c.term===t))))continue;
  if(rules.some(r=>normalize(r.title)===normalize(text)||normalize(r.sourceQuote)===normalize(text)&&r.requirementType===kind))continue;
  add({id,title:text,sourceQuote:text,requirementType:kind,weight:1,origin:'job'});
 }
 const manager=[...requirementClauses(job.manager_feedback).map((text,i)=>({id:'manager-'+(i+1),text,quote:text,kind:'manager_context'})),...managerSources];
 const adjustments=[];
 function withoutSoleOwnership(condition){
  if(condition.depth?.level==='ownership')return null;
  const group=condition.all?'all':condition.any?'any':null;if(!group)return condition;
  const children=condition[group].map(withoutSoleOwnership).filter(Boolean);
  return children.length?(group==='all'?all(children):any(children)):null;
 }
 for(const m of manager){
  if(excludedRequirement(m.text)){excluded.push({id:m.id,title:m.text,reason:'non_job_related_or_instruction'});continue;}
  // Team context is scope clarification, never evidence of a candidate's skills.
  if(/\b(?:do not|does not|not)\s+(?:independently|solely)\s+(?:own|build|design)/i.test(m.text)){
   for(const r of rules){const revised=withoutSoleOwnership(r.condition);if(revised&&JSON.stringify(revised)!==JSON.stringify(r.condition)){r.condition=revised;adjustments.push({priorityId:r.id,sourceId:m.id,sourceQuote:m.quote,type:'team_scope',effect:'Sole-ownership check removed by explicit manager clarification.'});}}
   continue;
  }
  if(/\b(?:team of|alongside|teamwork|collaborat|two other|three other)\b/i.test(m.text)&&!recognizedCapabilities(m.text).length){adjustments.push({sourceId:m.id,sourceQuote:m.quote,type:'team_scope',effect:'No sole-ownership assumption is added.'});continue;}
  const focused=m.text.replace(/more important than/ig,' over ').split(/\b(?:over|rather than|instead of)\b/i)[0];
  const clean=focused.replace(/\b(matters? most|most important|top priority|higher priority|is key|prioritize|prioritise|focus on|we need|manager wants|hiring manager wants|prefers?|preferred)\b/ig,' ').replace(/\s+/g,' ').trim();
  const caps=recognizedCapabilities(clean),terms=[...caps.flatMap(c=>capabilityCondition(c.term).terms),...credentials(clean).flatMap(termList)];
  const matches=rules.filter(r=>terms.some(t=>termList(r.condition).some(c=>hasTerm(c,t)||hasTerm(t,c))));
  const emphasize=/\b(matters? most|most important|top priority|higher priority|prioriti[sz]e|focus on|is key)\b/i.test(m.text);
  if(matches.length){
   for(const r of matches){
    if(emphasize&&['priority','recruiter'].includes(r.origin)){r.baseWeight??=r.weight;r.weight=r.baseWeight*2;adjustments.push({priorityId:r.id,sourceId:m.id,sourceQuote:m.quote,type:'explicit_emphasis',multiplier:2});}
    const optional=notRequired(m.text),updatedType=requirementType(m.text);
    if(optional||updatedType!=='inferred'){
     const previous=r.requirementType;r.requirementType=optional?(updatedType==='preferred'?'preferred':'inferred'):updatedType;
     if(previous!==r.requirementType)adjustments.push({priorityId:r.id,sourceId:m.id,sourceQuote:m.quote,type:'qualification_type',from:previous,to:r.requirementType});
    }
    // Only an explicit manager threshold changes a numerical requirement.
    // A reference to a candidate's tenure must not rewrite the job minimum.
    const threshold=durations(clean)[0];
    if(threshold&&/\b(required|minimum|at least|need|accept|enough|sufficient|prefer)\b/i.test(m.text)){
     const revise=c=>{
      if(c.experience&&c.experience.terms.some(t=>terms.some(x=>hasTerm(t,x)||hasTerm(x,t)))){
       if(c.experience.months!==threshold.months)adjustments.push({priorityId:r.id,sourceId:m.id,sourceQuote:m.quote,type:'experience_threshold',fromMonths:c.experience.months,toMonths:threshold.months});
       return {experience:{...c.experience,months:threshold.months}};
      }
      if(c.all)return all(c.all.map(revise));if(c.any)return any(c.any.map(revise));return c;
     };
     // Multiple distinct numbers require explicit separate clauses; do not use
     // the first number to rewrite every technology in a combined statement.
     if(durations(clean).length===1)r.condition=revise(r.condition);
    }
    const depth=depthFor(clean);if(depth)r.condition=all([r.condition,{depth:{level:depth,terms:r.capabilityTerms.length?r.capabilityTerms:termList(r.condition)}}]);
   }
  }else add({id:m.id,title:clean,sourceQuote:clean,requirementType:requirementType(m.text,'preferred'),weight:emphasize?2:1,origin:m.kind,question:'What specific work demonstrates this manager priority?'});
 }
 if(rules.length>64)issues.push({code:'too_many_requirements'});
 return {rules:rules.slice(0,64),excluded,issues,adjustments};
}
