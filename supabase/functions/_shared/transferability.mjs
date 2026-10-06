// Deterministic transferability hints for resume assessment.
// These hints are context for the model, never proof of direct experience.
const normalize = value => String(value || '').toLowerCase();

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

function hintsFor(group, resume, job) {
  const hints=[];
  for (const relation of group) {
    if (!job.includes(relation.target) || resume.includes(relation.target)) continue;
    const found=relation.related.filter(term=>resume.includes(term)).slice(0,6);
    if (!found.length) continue;
    hints.push({
      target: relation.target,
      concept: relation.concept,
      adjacent_evidence: found,
      instruction: 'Treat as transferable/adjacent evidence only. Do not claim direct '+relation.target+' experience without explicit resume evidence.'
    });
  }
  return hints;
}

export function transferabilityHints(resumeText, jobContext) {
  const resume=normalize(resumeText), job=normalize(jobContext);
  return [...hintsFor(relationships,resume,job),...hintsFor(workflowRelationships,resume,job)].slice(0,12);
}

export const transferabilityInstructions = `
ADJACENT AND TRANSFERABLE EVIDENCE
- Read beyond exact keywords. When direct evidence is absent, consider job-relevant adjacent tools, underlying concepts, comparable workflows, and responsibilities that reasonably transfer.
- Never treat a related tool as proof of the requested tool. "RabbitMQ" is not "Kafka"; "Selenium" is not "Playwright".
- Use deterministic transferability_hints only as prompts to inspect the cited resume evidence. They are not candidate facts by themselves.
- When adjacent evidence is strong, prefer partial over unknown and explain the transferable concept. Reserve supported for direct evidence or evidence that genuinely establishes the criterion.
- Several independent adjacent signals may justify a stronger partial finding than one superficial similarity.
- Distinguish tool transferability from workflow transferability. A candidate may demonstrate a workflow without naming its umbrella label.
- If the inference matters to the score, surface the uncertainty in the reason or a screening question rather than converting inference into certainty.
- Contradictory direct evidence overrides optimistic transferability.
`;
