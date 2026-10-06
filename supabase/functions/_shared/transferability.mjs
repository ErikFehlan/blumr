// Deterministic transferability hints for resume assessment.
// These hints are context for the model, never proof of direct experience.
import {evidenceTextRanges} from './source-instructions.mjs';
const normalize = value => String(value || '').toLowerCase().replace(/[‐‑–—]/g,'-');

const relationships = [
  { target:'playwright', related:['cypress','selenium','webdriver','test automation','typescript'], concept:'browser test automation' },
  { target:'cypress', related:['playwright','selenium','webdriver','test automation','javascript','typescript'], concept:'browser test automation' },
  { target:'selenium', related:['playwright','cypress','webdriver','test automation'], concept:'browser test automation' },
  { target:'kafka', related:['rabbitmq','azure service bus','service bus','message queue','message broker','event-driven','event driven','asynchronous messaging','pub/sub'], concept:'event-driven messaging' },
  { target:'rabbitmq', related:['kafka','azure service bus','service bus','message queue','message broker','event-driven','event driven','asynchronous messaging','pub/sub'], concept:'event-driven messaging' },
  { target:'azure service bus', related:['kafka','rabbitmq','message queue','message broker','event-driven','event driven','asynchronous messaging','pub/sub'], concept:'event-driven messaging' },
  { target:'github actions', related:['azure devops','jenkins','gitlab ci','circleci','ci/cd','continuous integration'], concept:'CI/CD automation' },
  { target:'azure devops', related:['github actions','jenkins','gitlab ci','circleci','ci/cd','continuous integration'], concept:'CI/CD automation' },
  { target:'jenkins', related:['github actions','azure devops','gitlab ci','circleci','ci/cd','continuous integration'], concept:'CI/CD automation' },
  { target:'react', related:['angular','vue','javascript','typescript','single page application','spa'], concept:'modern front-end development' },
  { target:'angular', related:['react','vue','javascript','typescript','single page application','spa'], concept:'modern front-end development' },
  { target:'aws', related:['azure','gcp','google cloud','cloud infrastructure'], concept:'public cloud engineering' },
  { target:'azure', related:['aws','gcp','google cloud','cloud infrastructure'], concept:'public cloud engineering' },
  { target:'gcp', related:['aws','azure','google cloud','cloud infrastructure'], concept:'public cloud engineering' },
  { target:'palo alto', related:['fortinet','cisco asa','cisco firepower','checkpoint','firewall','network security'], concept:'enterprise firewall engineering' },
  { target:'fortinet', related:['palo alto','cisco asa','cisco firepower','checkpoint','firewall','network security'], concept:'enterprise firewall engineering' },
  { target:'terraform', related:['cloudformation','bicep','pulumi','infrastructure as code','iac'], concept:'infrastructure as code' },
  { target:'kubernetes', related:['openshift','eks','aks','gke','container orchestration','docker swarm'], concept:'container orchestration' },
  { target:'servicenow', related:['it service management','itsm','itil','service management platform'], concept:'enterprise service management' },
  { target:'snowflake', related:['bigquery','redshift','synapse','data warehouse','cloud data warehouse'], concept:'cloud data warehousing' },
  { target:'microsoft fabric', related:['power bi','synapse','data factory','lakehouse','delta lake'], concept:'Microsoft analytics and lakehouse ecosystem' },
];

const workflowRelationships = [
  {
    target:'secure sdlc',
    related:['sast','dast','threat model','secure code review','code review','security gate','devsecops','owasp','vulnerability remediation'],
    concept:'secure software development lifecycle'
  },
  {
    target:'devsecops',
    related:['sast','dast','threat model','secure code review','security gate','ci/cd security','pipeline security','vulnerability remediation'],
    concept:'security integrated into software delivery'
  },
  {
    target:'site reliability',
    related:['sre','observability','incident response','on-call','on call','slis','slos','error budget','prometheus','grafana'],
    concept:'reliability engineering workflow'
  },
  {
    target:'application security',
    related:['sast','dast','owasp','threat model','secure code review','api security','vulnerability remediation','devsecops'],
    concept:'application security engineering workflow'
  },
  {
    target:'vulnerability management',
    related:['tenable','nessus','qualys','defender vulnerability management','vulnerability scanning','remediation tracking','cvss'],
    concept:'vulnerability identification and remediation workflow'
  },
  {
    target:'agile',
    related:['scrum','kanban','sprint planning','retrospective','backlog grooming','user stories'],
    concept:'iterative software delivery'
  }
];

// Boundaries avoid React/reactive, SPA/Spanish and AWS/draws matches.
const escapeRE = value => value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function has(text,term){return new RegExp('(^|[^a-z0-9])'+escapeRE(normalize(term))+'(?=$|[^a-z0-9])','i').test(normalize(text));}
const aliases={'secure sdlc':['ssdlc','secure software development lifecycle'],'site reliability':['sre','site reliability engineering'],'application security':['appsec'],'palo alto':['pan-os','panorama'],'gcp':['google cloud']};
function negative(text,term){
 const t=normalize(text),at=t.indexOf(normalize(term));
 if(at<0)return false;
 const before=t.slice(Math.max(0,at-100),at),after=t.slice(at+term.length,at+term.length+70);
 return /\b(no|not|never|without|lack(?:s|ing)?|unfamiliar|learning|studying|interested in|plan to)\b[^.;:]*$/.test(before)
   || /^\s*(?:experience\s*)?(?:is |was )?(?:not |none|only theoretical|not hands-on)/.test(after);
}
function fragments(source){
 return evidenceTextRanges(source.text||'').flatMap(text=>text.split(/\n+|(?<=[.!?;])\s+/)).map(text=>text.trim()).filter(text=>text.length>=12&&text.length<=1000);
}
export function candidateEvidence(source){
 return /^(resume quotation|candidate feedback|recruiter screening|recruiter correction|recruiter clarification|interview outcome)/.test(source.kind||'');
}
function hintsFor(group, sources, job, kind) {
 const hints=[];
 for(const relation of group){
  const names=[relation.target,...(aliases[relation.target]||[])];
  if(!names.some(term=>has(job,term)))continue;
  const excerpts=sources.flatMap(source=>fragments(source).map(quote=>({source_id:source.id,quote})));
  // A target mention is not automatically direct positive experience, including negation.
  const targetExcerpts=excerpts.filter(e=>names.some(term=>has(e.quote,term)));
  if(targetExcerpts.some(e=>names.some(term=>has(e.quote,term)&&!negative(e.quote,term))))continue;
  if(targetExcerpts.some(e=>names.some(term=>has(e.quote,term)&&negative(e.quote,term))))continue;
  const signals=new Map();
  for(const term of relation.related){
   const e=excerpts.find(e=>has(e.quote,term)&&!negative(e.quote,term));
   if(!e)continue;
   // Collapse overlapping aliases and repeated mentions; repetition is not corroboration.
   const canonical=term.replace('event driven','event-driven').replace('azure service bus','service bus');
   if(!signals.has(canonical))signals.set(canonical,{term,...e});
  }
  if(!signals.size)continue;
  const evidence=[...signals.values()].slice(0,6);
  const substantive=evidence.filter(e=>!['javascript','typescript','spa','cloud infrastructure','code review','owasp','itil'].includes(e.term));
  const strength=substantive.length>=2?'medium':'low';
  hints.push({target:relation.target,kind,concept:relation.concept,adjacent_evidence:evidence.map(e=>e.term),evidence,
   confidence_ceiling:strength,verification_question:'Which parts of '+relation.target+' have you personally used, and how does your related experience transfer?',
   instruction:'Treat as transferable/adjacent evidence only. Do not claim direct '+relation.target+' experience without explicit resume evidence.'});
 }
 return hints;
}
export function transferabilityHints(resumeOrSources, jobContext) {
 const sources=typeof resumeOrSources==='string'?[{id:'resume',kind:'resume quotation',text:resumeOrSources}]:
   (Array.isArray(resumeOrSources)?resumeOrSources:[]).filter(candidateEvidence);
 const job=typeof jobContext==='string'?jobContext:JSON.stringify(jobContext||{});
 return [...hintsFor(relationships,sources,job,'tool'),...hintsFor(workflowRelationships,sources,job,'workflow')].slice(0,12);
}

export const transferabilityInstructions = `
ADJACENT AND TRANSFERABLE EVIDENCE
- Read beyond exact keywords. Transferability is partial credit, never proof of years, certification, required direct tool experience or a mandatory credential. Missing keywords alone must not trigger a rejection. Assess the underlying capability and propose a focused screen when it could change the recommendation. Do not raise fit solely because the manager wants an interview.
- Read beyond exact keywords. When direct evidence is absent, consider job-relevant adjacent tools, underlying concepts, comparable workflows, and responsibilities that reasonably transfer.
- Never treat a related tool as proof of the requested tool. "RabbitMQ" is not "Kafka"; "Selenium" is not "Playwright".
- Use deterministic transferability_hints only as prompts to inspect the cited resume evidence. They are not candidate facts by themselves.
- When adjacent evidence is strong, prefer partial over unknown and explain the transferable concept. Reserve supported for direct evidence or evidence that genuinely establishes the criterion.
- Several independent adjacent signals may justify a stronger partial finding than one superficial similarity.
- Distinguish tool transferability from workflow transferability. A candidate may demonstrate a workflow without naming its umbrella label.
- If the inference matters to the score, surface the uncertainty in the reason or a screening question rather than converting inference into certainty.
- Contradictory direct evidence overrides optimistic transferability.
`;
