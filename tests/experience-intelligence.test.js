const test=require('node:test'),assert=require('node:assert/strict');
const api=import('../supabase/functions/_shared/experience-intelligence.mjs');
const source=text=>[{id:'resume-full',kind:'resume quotation',text}];
const occupations=[
 ['Account Executive','full cycle sales','Sourced outbound prospects across 40 accounts. Performed discovery and qualified customer needs. Prepared proposals for new accounts. Negotiated and closed deals.','sales-cycle'],
 ['Accountant','month end close','Reconciled bank balances. Prepared journal entries. Prepared financial statements. Tested internal controls.','financial-close'],
 ['Care Coordinator','care coordination','Assessed patient care needs. Prepared care plans. Coordinated referrals. Monitored patient progress.','care-process'],
 ['Teacher','instructional planning','Assessed learning needs. Developed lesson plans. Taught classroom instruction. Measured student progress.','teaching'],
 ['Maintenance Technician','equipment maintenance','Inspected equipment for faults. Repaired damaged motors. Tested equipment operation. Scheduled preventive maintenance.','maintenance'],
 ['Warehouse Supervisor','inventory management','Processed inbound goods receipts. Tracked inventory. Coordinated shipments. Planned replenishment.','inventory'],
 ['Recruiter','full cycle recruiting','Sourced candidates. Screened applicants. Coordinated interviews. Negotiated offers.','recruiting'],
 ['Marketing Manager','campaign management','Analyzed audience research. Created campaign plans. Launched campaigns. Measured campaign performance.','marketing-campaign'],
 ['Executive Assistant','executive support','Managed calendars. Coordinated travel. Prepared meeting agendas. Tracked action items.','administrative-coordination'],
 ['Security Engineer','secure SDLC','Performed threat modeling. Integrated security scans into pipelines. Verified closure of vulnerabilities.','secure-delivery']
];
for(const [title,criterion,text,key] of occupations)test(`${title}: linked work supports a bounded workflow with original evidence`,async()=>{
 const {buildExperienceIntelligence}=await api,p=buildExperienceIntelligence(source(text),{title,criteria:[criterion]});
 const w=p.workflows.find(w=>w.key===key);assert.ok(w);assert.ok(w.phases.length>=2);assert.equal(w.status,'partial');assert.equal(w.confidence_ceiling,'medium');assert.ok(w.evidence.every(e=>text.includes(e.quote)));assert.ok(p.activities.length>=2);
});
test('an unlisted occupation keeps open-text experience without an occupation whitelist',async()=>{
 const {buildExperienceIntelligence,enrichExperience}=await api,sources=source('Restored fresco murals and documented pigment analysis. Led restoration planning for two chapels.');
 const job={criteria:['Fresco restoration planning']},p=buildExperienceIntelligence(sources,job);
 assert.ok(p.activities.some(f=>f.depth==='ownership'));const r={criteria_assessment:[{criterion:job.criteria[0],status:'partial',evidence_type:'inferred',source_ids:['resume-full'],confidence_score:60,inference_kind:'responsibility'}]};
 enrichExperience(r,sources,job,p);assert.ok(r.criteria_assessment[0].experience_depth.length);assert.equal(r.verification_priorities.length,1);
});
test('responsibility is tied to explicit actions; exposure, limitations, and unrelated sources cannot make workflows',async()=>{
 const {buildExperienceIntelligence}=await api;
 for(const text of ['Our team managed inventory and processed shipments.','I only assisted with inventory and supported inbound receipts.','Never performed inventory tracking or coordinated shipments.','Learning inventory control and interested in warehouse operations.','Prepared campaign plans.']){
  const p=buildExperienceIntelligence(source(text),{criteria:['inventory management','campaign management']});assert.equal(p.workflows.length,0,text);
 }
 const p=buildExperienceIntelligence([...source('Owned financial forecasts. Implemented close controls. Maintained account reconciliations. Assisted with audit preparation.'),{id:'lesson',kind:'automatic learning',text:'Owned all sales cycles.'}],{});
 assert.deepEqual(p.activities.map(a=>a.depth),['ownership','implementation','practice','contribution']);assert.equal(p.activities.some(a=>a.source_id==='lesson'),false);
});
test('consulting projects retain explicit employer context and overlapping dates count once',async()=>{
 const {buildExperienceIntelligence}=await api;
 const p=buildExperienceIntelligence(source('Employer: Example Consulting\nClient Alpha Jan 2020 - Dec 2021\nManaged project schedules.\nClient Beta Jan 2021 - Dec 2022\nCoordinated project delivery.\nEducation\nJan 2010 - Dec 2014\nDeveloped a thesis.'),{criteria:['project delivery']},{asOf:'2026-10-06'});
 assert.equal(p.career.episodes.length,2);assert.equal(p.career.documented_months,36);assert.equal(p.career.has_overlaps,true);assert.equal(p.career.consulting_projects,2);assert.deepEqual(p.career.explicit_employer_groups,[{employer:'Example Consulting',projects:2}]);assert.equal(p.activities.length,2);
 const vague=buildExperienceIntelligence(source('Consultant 2020 - 2022\nManaged projects.'),{}, {asOf:'2026-10-06'});assert.equal(vague.career.documented_months,null);assert.equal(vague.career.partial_dates,true);
 const numeric=buildExperienceIntelligence(source('Operator 01/2020 - 06/2020\nOperated production equipment.'),{}, {asOf:'2026-10-06'});assert.equal(numeric.career.documented_months,6);
});
test('activities in separate engagements do not imply a complete shared workflow',async()=>{
 const {buildExperienceIntelligence}=await api;
 const p=buildExperienceIntelligence(source('Client A Jan 2020 - Dec 2021\nSourced outbound prospects.\nClient B Jan 2022 - Dec 2023\nNegotiated and closed deals.'),{criteria:['full cycle sales']});assert.equal(p.workflows.length,0);
});
test('required credentials get first question, supported answers are not asked again, and history never changes fit',async()=>{
 const {enrichExperience}=await api,sources=source('Coordinated care planning and referrals.');
 sources.push({id:'auto-history',kind:'automatic learning',inference_history:{criterion_key:'care coordination',inference_kind:'workflow',confirmed:1,contradicted:5,candidates:6,jobs:2}});
 const r={score:8,manager_score:8,screening_questions:['generic'],evidence_summary:{},criteria_assessment:[
 {criterion:'Care coordination',status:'partial',evidence_type:'inferred',source_ids:['resume-full'],confidence_score:65,inference_kind:'workflow'},
 {criterion:'Required RN license',status:'unknown',evidence_type:'unknown',source_ids:[],confidence_score:0},
 {criterion:'Patient communication',status:'supported',evidence_type:'direct',source_ids:['resume-full'],confidence_score:85}]};
 enrichExperience(r,sources,{criteria:r.criteria_assessment.map(c=>c.criterion)});assert.equal(r.verification_priorities[0].criterion,'Required RN license');assert.equal(r.verification_priorities.length,2);assert.equal(r.criteria_assessment[0].confidence_score,35);assert.equal(r.score,8);assert.equal(r.manager_score,8);assert.doesNotMatch(r.screening_questions.join(' '),/Patient communication/);
});
test('history requires comparable kind, independent counts and current candidate evidence; credentials never get a boost',async()=>{
 const {enrichExperience,historyForCriterion}=await api;
 const sources=source('Managed contract negotiations with suppliers.');
 sources.push({id:'auto-history',kind:'automatic learning',inference_history:{criterion_key:'contract negotiations',inference_kind:'responsibility',confirmed:11,contradicted:1,candidates:12,jobs:3}});
 assert.equal(historyForCriterion(sources,'Contract negotiations','tool'),null);
 const make=()=>({criteria_assessment:[{criterion:'Contract negotiations',status:'partial',evidence_type:'inferred',source_ids:['resume-full'],confidence_score:55,inference_kind:'responsibility'}]});
 const r=enrichExperience(make(),sources,{});assert.equal(r.criteria_assessment[0].confidence_score,65);
 const empty=enrichExperience(make(),sources.slice(1),{});assert.equal(empty.criteria_assessment[0].confidence_score,55);
 sources[1].kind='candidate feedback';assert.equal(historyForCriterion(sources,'Contract negotiations'),null);
 const credential={criteria_assessment:[{criterion:'CPA certification',status:'partial',evidence_type:'inferred',source_ids:['resume-full'],confidence_score:70}]};assert.equal(enrichExperience(credential,sources,{}).criteria_assessment[0].confidence_score,35);
});
test('optional evidence UI escapes text and needs no extra form or approval',async()=>{
 const memory=require('../assets/assessment-memory.js');
 const html=memory.details({criteria_assessment:[],experience_profile:{career:{episodes:[{}],explicit_employer_groups:[{employer:'<img src=x>',projects:2}]}},verification_priorities:[{question:'<script>bad</script>',reason:'Verify scope'}]});
 assert.match(html,/Most useful to verify next/);assert.doesNotMatch(html,/<script>|<img|<form|<button/);
});
