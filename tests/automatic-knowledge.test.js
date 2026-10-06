const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const context=require('../assets/context.js'),memory=require('../assets/assessment-memory.js');
const id='auto-'+'a'.repeat(32);
const pattern={id,rule_key:'a'.repeat(32),text:'Verified RabbitMQ experience may transfer to Kafka; verify exact tool experience.',last_seen:'2026-10-06'};
test('automatic role knowledge uses the shared transferability catalog',async()=>{
 const {catalogSQL,knowledgeCatalog}=await import('../scripts/knowledge-catalog.mjs');
 const migration=fs.readFileSync('supabase/migrations/20261006174613_automatic_role_knowledge.sql','utf8');
 assert.ok(migration.includes(catalogSQL()));assert.ok(knowledgeCatalog.some(r=>r.target==='secure sdlc'&&r.related.includes('sast')));
});
test('automatic job context requires no candidate action and never becomes candidate evidence',async()=>{
 const {withDetails,validateDetails}=await import('../supabase/functions/_shared/assessment-depth.mjs');
 const job={id:'j',title:'Developer',criteria:['Kafka'],automaticKnowledge:[pattern]};
 const built=context.build(job,{id:'c'},[],[]);assert.equal(built.sources.find(s=>s.id===id).kind,'automatic learning');
 const resume={id:'resume-1',kind:'resume quotation',text:'Built reliable RabbitMQ services and retry handlers.'};
 const sources=[...built.sources,resume],schema=withDetails({properties:{},required:[]},false,{sources,criteria:['Kafka']});
 assert.deepEqual(schema.properties.applied_lessons.items.properties.lesson_id.enum,[id]);
 assert.ok(schema.properties.criteria_assessment.items.anyOf.every(f=>!f.properties.source_ids.items.enum?.includes(id)));
 const result={criteria_assessment:[{criterion:'Kafka',status:'partial',evidence_type:'inferred',confidence:'medium',reason:'Related messaging work.',inference_basis:'Messaging concepts transfer; Kafka needs verification.',source_ids:['resume-1']}],feedback_impact:{effect:'initial',summary:'Current source evidence assessed.',source_ids:[]},applied_lessons:[{lesson_id:id,application:'Checked adjacent messaging experience.'}]};
 const r=validateDetails(result,sources);assert.equal(r.applied_lessons[0].automatic,true);assert.match(memory.details(r),/Automatic context/);
 assert.ok(r.criteria_assessment[0].confidence_score<=70);
 result.criteria_assessment[0].source_ids=[id];assert.throws(()=>validateDetails(result,sources),e=>e.validationIssue==='memory_as_evidence');
 const {validatePriorityAssessment}=await import('../supabase/functions/_shared/priority-assessment.mjs');
 assert.throws(()=>validatePriorityAssessment({priority_assessment:[{priority_id:'p',status:'supported',reason:'Memory says so',source_ids:[id],question:''}]},{items:[{id:'p'}]},sources));
});
test('a learned relationship does not manufacture transferable experience in a new candidate',async()=>{
 const {prepare}=await import('../supabase/functions/reassess-job/logic.mjs');
 const p=prepare({job:{id:'j',title:'Developer',criteria:['Kafka'],automaticKnowledge:[pattern]},candidate:{id:'c',jobId:'j',jdScore:5,managerScore:5},resume_text:'Managed a retail schedule and trained store staff.'});
 assert.equal(p.payload.transferability_hints.length,0);
 assert.ok(p.sources.some(s=>s.id===id&&s.kind==='automatic learning'));
});
test('learning controls remain optional and do not add a job setup step',()=>{
 const wizard=fs.readFileSync('assets/job-wizard.js','utf8');assert.match(wizard,/\['Job Details','Requirements','Top 5 Priorities','Review'\]/);
 assert.match(wizard,/Relevant learning.*applied automatically/);
 const proposed=memory.suggestions({status:'ready',revision:'r',result:{learning_suggestions:[{kind:'evaluation_method',text:'Inspect ownership.'}]}},{id:'c'});
 assert.match(proposed,/Optional custom lessons/);assert.doesNotMatch(proposed,/<details[^>]*\bopen\b/);
});
test('staging verifies the exact knowledge functions and private execution permissions',async()=>{
 const {knowledgeExpectations,structuralDifferences}=await import('../scripts/staging-structure.mjs');
 const expected=knowledgeExpectations(fs.readFileSync('supabase/migrations/20261006174613_automatic_role_knowledge.sql','utf8'));
 assert.equal(expected.size,13);
 const stage=[...expected].map(([key,e])=>({kind:'function',name:key.slice(9),routine:{source:e.body,language:e.language,result:e.result,setof:false,args:e.args,defaults:null,security_definer:e.securityDefiner,volatility:e.volatility,config:['search_path=""'],clients_denied:!e.admin,worker_allowed:!e.private,anon_denied:true,authenticated_allowed:e.admin}}));
 assert.deepEqual(structuralDifferences([],stage,expected),[]);
 stage.find(r=>r.name==='blumr_knowledge.capture_candidate(uuid)').routine.worker_allowed=true;
 assert.deepEqual(structuralDifferences([],stage,expected),['function:blumr_knowledge.capture_candidate(uuid)']);
 assert.throws(()=>knowledgeExpectations(''));
});
