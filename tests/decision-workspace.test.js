const test=require('node:test'),assert=require('node:assert/strict');
const d=require('../assets/decision-workspace.js'),p=require('../assets/presentation.js');
const items=[{id:'p1',title:'Own release testing',reason:'Releases need reliable coverage.',question:'Which releases did you own?',source_quote:'Own release test plans.',requirement_type:'required'}];
const job={id:'job-a',title:'QA Analyst',description:'Own release test plans.',hiringPriorities:{source_title:'QA Analyst',source_description:'Own release test plans.',items}};
const candidate=()=>({id:'one',jobId:'job-a',short:'Alex Lee',stage:'Screened',jdScore:8,managerScore:7.5,strengths:['Owned release test plans.'],concerns:[],aiReview:{contextSignature:'current',assessment:{hiring_priorities:structuredClone(job.hiringPriorities),priority_assessment:[{priority_id:'p1',status:'supported',reason:'Release test plans are documented.',source_ids:['resume-quote-1'],question:'Which releases did you own?'}],resume_evidence:[{source_id:'resume-quote-1',claim:'Owned release test plans.',quote:'Owned test plans for monthly releases.'}]}}});
test('comparison resolves only saved source IDs and leaves the assessment unchanged',()=>{
 const c=candidate(),before=JSON.stringify(c),f=d.finding(c,job,items[0],'current');assert.equal(f.label,'Evidence found');assert.equal(f.evidence[0].quote,'Owned test plans for monthly releases.');assert.equal(JSON.stringify(c),before);
 c.aiReview.assessment.resume_evidence[0].source_id='different';assert.deepEqual(d.finding(c,job,items[0],'current').evidence,[],'matching words cannot fabricate a source link');
});
test('changed context and reused priority IDs cannot show outdated evidence as current',()=>{
 const c=candidate();assert.equal(d.finding(c,job,items[0],'new context').status,'stale');
 c.aiReview.assessment.hiring_priorities.items[0].title='Own security testing';assert.equal(d.finding(c,job,items[0],'current').status,'stale');
 assert.deepEqual(d.priorities({...job,description:'Different requirements'}),[]);
});
test('missing assessments and unknown statuses remain explicitly unassessed',()=>{
 const c=candidate();delete c.aiReview.assessment.priority_assessment;assert.equal(d.finding(c,job,items[0]).status,'unassessed');
 c.aiReview.assessment.priority_assessment=[{priority_id:'p1',status:'invented'}];assert.equal(d.finding(c,job,items[0]).label,'Not assessed');
});
test('selection uses candidate IDs, removes duplicates and foreign jobs, and permits duplicate names',()=>{
 const candidates=[candidate(),{...candidate(),id:'two'},{...candidate(),id:'foreign',jobId:'job-b'}];assert.deepEqual(d.selection(['one','two','one','foreign','gone'],candidates,'job-a'),['one','two']);
 assert.deepEqual(d.selection(['one','two'],candidates,'job-b'),[]);
});
test('pending assessments never expose proposed fit scores as saved scores',()=>{
 const c={...candidate(),id:'pending',aiReview:null,resumeIntake:{phase:'ready'},jdScore:9.123,managerScore:9.123};
 const html=d.comparisonHTML(job,[c,{...candidate(),id:'other'}]);assert.match(html,/Awaiting assessment review/);assert.doesNotMatch(html,/9\.1/);
});
test('summary counts actionable candidates in this job and excludes terminal stages',()=>{
 const ready={...candidate(),id:'ready',aiReview:null,resumeIntake:{phase:'ready'}},working={...ready,id:'working',resumeIntake:{phase:'processing'}};
 const list=[candidate(),ready,working,{...candidate(),id:'rejected',stage:'Rejected'},{...candidate(),id:'other',jobId:'job-b'}];const m=d.summary(job,list);assert.equal(m.list.length,3);assert.equal(m.needsReview.length,1);assert.equal(m.working.length,1);assert.equal(m.drafts.length,1);
});
test('comparison escapes source passages, names and job priority content',()=>{
 const c=candidate();c.short='<img src=x onerror=alert(1)>';c.aiReview.assessment.resume_evidence[0].quote='<script>alert(1)</script>';
 const html=d.comparisonHTML(job,[c,{...candidate(),id:'two'}]);assert.doesNotMatch(html,/<img|<script/);assert.match(html,/&lt;script&gt;/);
});
test('submittal excludes strengths explicitly marked unsupported without matching by index alone',()=>{
 const c={strengths:['Owned release test plans. — Resume: “Owned test plans.”','Coordinated releases.'],resumeIntake:{brief:{resume_evidence:[{claim:'Owned release test plans.',quote:'Owned test plans.'}]},evidenceReviews:{'strength-0':{status:'unsupported'}}}};
 assert.deepEqual(p.sellingPoints(c),['Coordinated releases.']);
 c.strengths.reverse();assert.deepEqual(p.sellingPoints(c),['Coordinated releases.']);
 c.resumeIntake.brief.resume_evidence[0]={claim:'A different historical claim.',quote:'Different quote.'};assert.equal(p.sellingPoints(c).length,2);
});

test('shortlist profiles keep pending and stale assessments distinct from current evidence',()=>{
 const pending={...candidate(),id:'pending',aiReview:null,resumeIntake:{phase:'ready'},jdScore:9.4,managerScore:9.4};
 const html=d.shortlistHTML([pending]);assert.match(html,/Awaiting assessment review/);assert.doesNotMatch(html,/9\.4|Owned release test plans/);
 const stale=d.shortlistHTML([candidate()],{signature:()=> 'changed'});assert.match(stale,/Previously saved fit/);assert.match(stale,/Context changed/);assert.doesNotMatch(stale,/From saved strengths/);
});
test('comparison overview preserves candidate identity, saved score separation and unsupported-strength exclusions',()=>{
 const c=candidate();c.strengths=['Unsupported claim.','Owned release test plans.'];c.resumeIntake={reviewedAt:1,brief:{resume_evidence:[{claim:'Unsupported claim.',quote:'Source passage.'}]},evidenceReviews:{'strength-0':{status:'unsupported'}}};
 const other={...candidate(),id:'two',managerScore:5.4};const before=JSON.stringify([c,other]);
 const html=d.comparisonHTML(job,[c,other]);assert.match(html,/data-profile-candidate="one"/);assert.match(html,/data-profile-candidate="two"/);assert.doesNotMatch(html,/Unsupported claim/);assert.match(html,/JD Fit/);assert.match(html,/Manager Fit/);assert.match(html,/5\.4/);assert.equal(JSON.stringify([c,other]),before);
});

test('unselected bulk candidates have no saved fit scores or automatic processing state',()=>{
 const c={...candidate(),aiReview:null,resumeIntake:null,screeningManaged:true};
 assert.equal(d.reviewState(c).label,'Bulk screening');
 const summary=d.summary(job,[c]);assert.equal(summary.working.length,0);assert.equal(summary.needsReview.length,0);
 assert.doesNotMatch(d.shortlistHTML([c]),/8\.0/);assert.match(d.shortlistHTML([c]),/bulk screening/i);
});
