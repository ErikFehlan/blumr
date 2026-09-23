const test=require('node:test'),assert=require('node:assert/strict');
const logic=import('../supabase/functions/reassess-job/logic.mjs');
function input(){return {job:{id:'j',title:'QA',description:'Manual QA',criteria:['Must Have | manual testing'],weights:[],knockouts:[]},candidate:{id:'c',jobId:'j',managerScore:7,jdScore:7,resumeJDScore:7,role:'QA',tags:[],strengths:['Built manual regression tests'],concerns:[]},feedback:[{id:'own',jobId:'j',candidateId:'c',type:'General note',text:'Explained hands-on ownership.',createdAt:1},{id:'other',jobId:'j',candidateId:'other',text:'PRIVATE CANDIDATE'},{id:'foreign',jobId:'elsewhere',candidateId:'c',text:'PRIVATE JOB'},{id:'approved',jobId:'j',candidateId:'other',text:'Manual work matters',learningScope:'job',signalStatus:'approved',signalDirection:'positive',signalLabel:'Hands-on manual testing'}],outcomes:[]};}
test('worker uses the same evidence model, includes shared approvals, and isolates private notes',async()=>{
 const {prepare}=await logic,prepared=prepare(input()),text=JSON.stringify(prepared.payload);
 assert.match(text,/hands-on ownership/);assert.match(text,/Hands-on manual testing/);assert.doesNotMatch(text,/PRIVATE/);
 assert.ok(prepared.sourceIds.has('preference-approved'));assert.match(prepared.contextSignature,/^context-v1-/);
 assert.throws(()=>prepare({...input(),candidate:{...input().candidate,jobId:'other'}}),/invalid_scope/);
});
test('worker rejects invented source references, invalid scores, and unbounded questions',async()=>{
 const {prepare,validate}=await logic,p=prepare(input());
 const result={criteria_assessment:[{criterion:'Must Have | manual testing',status:'supported',reason:'Candidate described hands-on ownership.',source_ids:['feedback-own']}],feedback_impact:{effect:'new_evidence',summary:'Ownership clarified.',source_ids:['feedback-own']},applied_lessons:[],learning_suggestions:[],manager_score:8,jd_score:7,confidence:'medium',summary:'Evidence reviewed',manager_reason:'Ownership supports manual testing',jd_reason:'Baseline unchanged',evidence_ids:['feedback-own'],evidence_support:[{source_id:'feedback-own',claim:'Ownership described',quote:'Explained hands-on ownership.'}],questions:['Which releases did you own?']};
 assert.equal(validate(result,p).context_signature,p.contextSignature);
 assert.throws(()=>validate({...result,evidence_ids:['invented']},p),/invalid_result/);
 assert.throws(()=>validate({...result,manager_score:11},p),/invalid_result/);
 assert.throws(()=>validate({...result,evidence_ids:[]},p),/invalid_result/);
 assert.throws(()=>validate({...result,evidence_support:undefined},p),/invalid_result/);
 assert.throws(()=>validate({...result,questions:Array(4).fill('Question')},p),/invalid_result/);
});
test('AI interpretations are never recycled as candidate evidence and corrections remain candidate-scoped',async()=>{
 const {prepare}=await logic,x=input();x.feedback[0].interpretation={source:'ai',text:'INVENTED INFERENCE'};
 assert.doesNotMatch(JSON.stringify(prepare(x).payload),/INVENTED/);
 x.feedback[0].interpretation={source:'recruiter',text:'Clarified ownership',updatedAt:2};
 assert.match(JSON.stringify(prepare(x).payload),/Clarified ownership/);
});
test('reassessment schema requires candidate evidence and preserves exact requirement wording',async()=>{
 const {prepare,schema}=await logic,x=input();x.job.criteria=['-manual testing experience strongly required'];
 const p=prepare(x),s=schema(p),[supported,unknown]=s.properties.criteria_assessment.items.anyOf;
 assert.deepEqual(supported.properties.criterion.enum,x.job.criteria);
 assert.equal(supported.properties.source_ids.minItems,1);
 assert.equal(unknown.properties.source_ids.minItems,0);
 assert.deepEqual(unknown.properties.status.enum,['unknown']);
 assert.ok(supported.properties.source_ids.items.enum.includes('feedback-own'));
 for(const id of ['job-description','criterion-1','preference-approved'])assert.ok(!supported.properties.source_ids.items.enum.includes(id));
 assert.deepEqual(s.properties.learning_suggestions.items.properties.source_ids.items.enum,['feedback-own']);
 assert.equal(s.properties.applied_lessons.maxItems,0);
 const empty=prepare({job:{id:'j',title:'QA',description:'Manual testing required.'},candidate:{id:'c',jobId:'j',jdScore:7,managerScore:7}});
 assert.deepEqual(schema(empty).properties.criteria_assessment.items.properties.status.enum,['unknown']);
});
test('evidence selection attaches exact source text and rejects forged passages or quotations',async()=>{
 const {prepare,resolveEvidence}=await logic,x=input();
 x.resume_text=('Owned manual testing. Did not write or maintain automation.\n').repeat(30);
 const p=prepare(x),passage=p.passages.find(s=>s.source_id==='resume-full');
 assert.equal(new Set(p.passages.map(s=>s.id)).size,p.passages.length);
 for(const part of p.passages){assert.ok(p.sources.find(s=>s.id===part.source_id).text.includes(part.text));assert.ok(part.text.length<=1000);}
 const r=resolveEvidence({evidence_support:[{passage_id:passage.id,claim:'Manual testing with no automation authorship.'}]},p);
 assert.deepEqual(r.evidence_ids,['resume-full']);assert.equal(r.evidence_support[0].quote,passage.text);assert.match(r.evidence_support[0].quote,/Did not write/);
 for(const support of [{passage_id:'invented',claim:'Unsupported'},{passage_id:passage.id,quote:'Invented quote',claim:'Unsupported'},{passage_id:passage.id,source_id:'criterion-1',claim:'Unsupported'}])assert.throws(()=>resolveEvidence({evidence_support:[support]},p),/invalid_result/);
});
