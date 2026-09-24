const test=require('node:test'),assert=require('node:assert/strict');
const view=require('../assets/hiring-priorities.js'),context=require('../assets/context.js');
const job={id:'job',title:'QA Analyst',description:'Own manual regression testing. Automation experience is preferred.',criteria:[],knockouts:[]};
const item={id:'priority-1',title:'Manual regression ownership',reason:'Regression testing is the primary responsibility.',requirement_type:'inferred',source_quote:job.description,question:'What regression testing did you personally own?'};
const suggestions={title:job.title,description:job.description,items:[item]};
test('shared priorities survive candidate changes; stale descriptions and other jobs cannot supply priorities',()=>{
 const task={job_id:job.id,priority_suggestions:suggestions};job.hiringPriorities=view.effective(task,job);
 const a=context.build(job,{id:'a',jobId:'job',strengths:['Manual testing']},[],[]),b=context.build(job,{id:'b',jobId:'job',strengths:['Automation']},[],[]);
 assert.deepEqual(a.hiring_priorities,b.hiring_priorities);assert.equal(a.requirements.length,0,'suggestions must not become explicit criteria');
 assert.equal(a.sources.find(s=>s.id===item.id).kind,'requirement');
 assert.equal(view.effective(task,{...job,description:'A different role'}),null);
 assert.equal(context.build({...job,description:'A different role'},null,[],[]).hiring_priorities,undefined);
 assert.equal(view.effective({...task,job_id:'other'},job),null);
});
test('recruiter edits override suggestions only for their original job description',()=>{
 const task={job_id:job.id,priority_suggestions:suggestions,priority_review:{...suggestions,items:[{...item,title:'Manual test ownership'}],review_status:'edited'}};
 assert.equal(view.effective(task,job).items[0].title,'Manual test ownership');
 task.priority_review.description='Old description';assert.equal(view.effective(task,job).review_status,'suggested');
});
test('JD priority generation anchors exact passages, rejects invented sources and thresholds, and permits fewer than five',async()=>{
 const {jobPassages,validatePriorities,prioritiesSchema}=await import('../supabase/functions/refine-job-criteria/priorities.mjs');
 const passages=jobPassages(job),out=[{title:item.title,reason:item.reason,requirement_type:'required',source_id:passages[0].id,question:item.question}];
 const result=validatePriorities(out,passages);assert.equal(result.length,1);assert.ok(job.description.includes(result[0].source_quote));assert.equal(result[0].requirement_type,'inferred');
 assert.throws(()=>validatePriorities([{...out[0],source_id:'invented'}],passages),/invalid_priorities/);
 assert.throws(()=>validatePriorities([{...out[0],title:'10+ years of manual testing'}],passages),/invalid_priorities/);
 assert.throws(()=>validatePriorities([...out,...out],passages),/invalid_priorities/);
 assert.deepEqual(validatePriorities([],[]),[]);assert.equal(prioritiesSchema([]).maxItems,0);
});
test('priority findings require candidate evidence and cover every priority, while unknowns remain valid',async()=>{
 const {withPriorityAssessment,validatePriorityAssessment}=await import('../supabase/functions/_shared/priority-assessment.mjs');
 const priorities={basis:'job_description',review_status:'suggested',items:[item]},sources=[{id:'jd',kind:'requirement'},{id:'resume-1',kind:'resume quotation'}];
 const schema=withPriorityAssessment({required:[],properties:{}},priorities,sources);assert.deepEqual(schema.properties.priority_assessment.items.anyOf[0].properties.source_ids.items.enum,['resume-1']);
 const result={priority_assessment:[{priority_id:item.id,status:'unknown',reason:'Ownership is not established.',source_ids:[],question:item.question}]};
 assert.equal(validatePriorityAssessment(result,priorities,sources).hiring_priorities,priorities);
 assert.throws(()=>validatePriorityAssessment({...result,priority_assessment:[{...result.priority_assessment[0],status:'supported',source_ids:['jd']}]},priorities,sources),/invalid_assessment_details/);
 assert.throws(()=>validatePriorityAssessment({...result,priority_assessment:[]},priorities,sources),/invalid_assessment_details/);
 assert.throws(()=>validatePriorityAssessment({...result,priority_assessment:[{...result.priority_assessment[0],question:''}]},priorities,sources),/invalid_assessment_details/);
});
test('candidate view distinguishes suggestions and escapes source content',()=>{
 const html=view.details({hiring_priorities:{items:[{...item,title:'<script>fake</script>'}]},priority_assessment:[{priority_id:item.id,status:'unknown',reason:'No ownership evidence.',question:item.question}]});
 assert.match(html,/Suggested priorities/);assert.match(html,/Not established/);assert.match(html,/Manager preferences are unconfirmed/);assert.ok(!html.includes('<script>'));
});
