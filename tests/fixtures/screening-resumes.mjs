// Invented profiles only. Explicit archetypes support regression expectations;
// these are not real applicants or recruiter-labeled hiring decisions.
const scenarios=[
 {kind:'direct',title:'Platform Specialist',summary:'Implemented Azure infrastructure. Maintained Terraform automation.',detail:'Built Azure landing zones and implemented Terraform modules for repeatable environment provisioning.'},
 {kind:'alternative',title:'Cloud Engineer',summary:'Implemented AWS infrastructure. Maintained Terraform automation.',detail:'Built AWS infrastructure and maintained Terraform automation for deployment workflows.'},
 {kind:'mentions',title:'Software Engineer',summary:'Skills: Azure, AWS, infrastructure, Terraform, automation.',detail:'Familiar with Azure infrastructure and Terraform automation through team demonstrations.'},
 {kind:'adjacent',title:'Systems Specialist',summary:'Implemented GCP infrastructure. Maintained Bicep automation.',detail:'Built GCP infrastructure and implemented Bicep automation for environment provisioning.'},
 {kind:'unrelated',title:'Operations Coordinator',summary:'Coordinated vendor schedules and maintained purchase records.',detail:'Prepared purchase orders and reconciled delivery records for regional facilities.'},
 {kind:'contradicted',title:'Technology Analyst',summary:'No Azure, AWS, Terraform or infrastructure experience is claimed.',detail:'Observed application support demonstrations and documented service requests.'},
];
const activities=[
 'Documented service procedures and maintained an operational handover guide for colleagues.',
 'Coordinated monthly change windows with application owners and recorded the agreed sequence of work.',
 'Reviewed incident records, documented recurring issues and tracked follow-up actions to completion.',
 'Maintained a shared backlog of service improvements with clear acceptance criteria and assigned owners.',
 'Prepared weekly service reports from operational records and explained exceptions to stakeholders.',
 'Tested recovery procedures in a nonproduction environment and documented the observed outcomes.',
 'Worked with a team of three colleagues to deliver scheduled changes and verify service availability.',
 'Created support documentation with reproducible steps and reviewed it with the service desk.',
];
export function screeningResume(index){
 const scenario=scenarios[index%scenarios.length];
 const text=[`Synthetic Applicant ${index}`,scenario.title,'Professional summary',scenario.summary,
  'Professional experience','Example Services | January 2022 - September 2026',scenario.detail,...activities,
  'Example Operations | February 2018 - December 2021',...activities,
  'Projects',scenario.detail,'Prepared project documentation, recorded test results and coordinated delivery with the wider team.',
  'Tools and capabilities',scenario.summary].join('\n');
 return {kind:scenario.kind,text};
}
