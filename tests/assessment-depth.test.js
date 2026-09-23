const test=require('node:test'),assert=require('node:assert/strict');
const memory=require('../assets/assessment-memory.js');
const context=require('../assets/context.js');
const api=import('../supabase/functions/_shared/assessment-depth.mjs');
const sources=[{id:'feedback-a',kind:'candidate feedback',text:'The candidate only compiled forecasts.'},{id:'criterion-1',kind:'requirement',text:'Forecast ownership'},{id:'lesson-a',kind:'approved learning',text:'Distinguish support from ownership.'}];
const result=()=>({criteria_assessment:[{criterion:'Forecast ownership',status:'contradicted',reason:'Interview clarified contribution rather than ownership.',source_ids:['feedback-a']}],feedback_impact:{effect:'contradiction',summary:'Direct ownership is no longer supported.',source_ids:['feedback-a']},applied_lessons:[{lesson_id:'lesson-a',application:'Separated compiling inputs from owning the forecast.'}],learning_suggestions:[]});
test('assessment findings require real sources, complete criteria, and valid learning references',async()=>{
 const {validateDetails}=await api;
 assert.doesNotThrow(()=>validateDetails(result(),sources,{criteria:['Forecast ownership'],suggestions:true}));
 for(const id of ['invented','lesson-a','criterion-1']){const r=result();r.criteria_assessment[0].source_ids=[id];assert.throws(()=>validateDetails(r,sources),/invalid_assessment_details/);}
 const missing=result();missing.criteria_assessment=[];assert.throws(()=>validateDetails(missing,sources,{criteria:['Forecast ownership']}));
 const forged=result();forged.applied_lessons[0].lesson_id='feedback-a';assert.throws(()=>validateDetails(forged,sources));
 const unknown=result();unknown.criteria_assessment[0]={criterion:'Forecast ownership',status:'unknown',reason:'Ownership not yet established.',source_ids:[]};assert.doesNotThrow(()=>validateDetails(unknown,sources));
});
test('learning proposals need feedback or a recruiter correction, not recycled model output',async()=>{
 const {validateDetails}=await api,r=result();r.learning_suggestions=[{kind:'evaluation_method',text:'Distinguish compiling inputs from owning a forecast.',source_ids:['feedback-a']}];
 assert.doesNotThrow(()=>validateDetails(r,sources,{suggestions:true}));
 r.learning_suggestions[0].source_ids=['lesson-a'];assert.throws(()=>validateDetails(r,sources,{suggestions:true}));
 r.learning_suggestions[0].source_ids=['criterion-1'];assert.throws(()=>validateDetails(r,sources,{suggestions:true}));
});
test('only approved, applicable lessons enter context; private source observations do not transfer',()=>{
 const job={id:'new-job',title:'Finance Director',criteria:[]},base={id:'a',job_id:'old-job',kind:'evaluation_method',scope:'role',role_key:'finance director',active:true,text:'Verify ownership rather than team exposure.',updated_at:'2026-09-23T12:00:00+00:00',source_basis:{text:'PRIVATE PERSON DETAIL'}};
 const rows=[base,{...base,id:'b',active:false},{...base,id:'c',scope:'job'},{...base,id:'d',kind:'manager_priority'},{...base,id:'e',role_key:'qa analyst'}];
 job.assessmentLessons=memory.applicable(rows,job);assert.deepEqual(job.assessmentLessons.map(l=>l.id),['a']);
 const built=context.build(job,null,[],[]);assert.match(JSON.stringify(built),/Verify ownership/);assert.doesNotMatch(JSON.stringify(built),/PRIVATE PERSON DETAIL/);
 assert.equal(context.build({...job,assessmentLessons:rows},null,[],[]).sources.filter(s=>s.kind==='approved learning').length,1);
});
test('unchanged feedback remains visible and all generated explanation text is escaped',()=>{
 const r=result();r.feedback_impact={effect:'confirmation',summary:'Score unchanged: feedback confirms the existing evidence.',source_ids:['feedback-a']};
 assert.match(memory.details(r),/Score unchanged/);
 r.criteria_assessment[0].reason='<img src=x onerror=alert(1)>';assert.doesNotMatch(memory.details(r),/<img/);
 const task={status:'ready',revision:'rev',result:{learning_suggestions:[{kind:'manager_priority',text:'Audit ownership is required.'}]}};
 assert.doesNotMatch(memory.suggestions(task,{id:'c'}),/value="role"/);
});
test('reassessments re-read original resume evidence without destabilizing client context signatures',async()=>{
 const {prepare}=await import('../supabase/functions/reassess-job/logic.mjs');
 const input={job:{id:'j',title:'Finance Director',criteria:[]},candidate:{id:'c',jobId:'j',managerScore:7,jdScore:7},feedback:[],outcomes:[]};
 const old=prepare(input),full=prepare({...input,resume_text:'Owned cash forecasts and a seven-person team.'});
 assert.equal(old.contextSignature,full.contextSignature);assert.ok(full.sourceIds.has('resume-full'));assert.match(JSON.stringify(full.payload),/seven-person/);
});
