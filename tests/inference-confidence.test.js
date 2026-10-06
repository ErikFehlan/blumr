const test=require('node:test'),assert=require('node:assert/strict');
const api=import('../supabase/functions/_shared/assessment-depth.mjs');
const memory=require('../assets/assessment-memory.js');
const source={id:'resume-1',kind:'resume quotation',text:'Built messaging services using RabbitMQ and Azure Service Bus with retries and dead-letter queues.'};
const row=(overrides={})=>({criterion:'Kafka',status:'partial',evidence_type:'inferred',confidence:'high',reason:'Messaging concepts transfer; Kafka usage needs confirmation.',inference_basis:'RabbitMQ and Service Bus provide adjacent messaging experience.',source_ids:['resume-1'],...overrides});
const result=c=>({criteria_assessment:[c||row()],feedback_impact:{effect:'initial',summary:'Current source evidence reviewed.',source_ids:[]},applied_lessons:[],learning_suggestions:[]});

test('all four evidence types are representable by the schema and enforce matching statuses',async()=>{
 const {withDetails,validateDetails}=await api;
 const schema=withDetails({properties:{},required:[]},false,{sources:[source],criteria:['Kafka']});
 const variants=schema.properties.criteria_assessment.items.anyOf;
 for(const [status,type] of [['supported','direct'],['partial','inferred'],['contradicted','contradicted'],['unknown','unknown']]){
  assert.ok(variants.some(v=>v.properties.status.enum.includes(status)&&v.properties.evidence_type.enum.includes(type)));
  assert.doesNotThrow(()=>validateDetails(result(row({status,evidence_type:type,inference_basis:type==='inferred'?'Adjacent messaging concepts.':''})),[source]));
 }
 for(const overrides of [{status:'supported'}, {status:'partial',evidence_type:'unknown'}, {evidence_type:'contradicted'}, {status:'contradicted',evidence_type:'direct',inference_basis:''}, {inference_basis:''}]){
  assert.throws(()=>validateDetails(result(row(overrides)),[source]),e=>e.validationIssue==='criterion_evidence_type');
 }
});

test('inferred confidence is capped and source quotations and screening questions are attached by the server',async()=>{
 const {validateDetails}=await api,r=validateDetails(result(),[source]);const c=r.criteria_assessment[0];
 assert.equal(c.confidence,'medium');assert.ok(c.confidence_score<=70);assert.equal(c.inference_kind,'tool');
 assert.equal(c.evidence[0].quote,source.text);assert.match(c.verification_question,/kafka/i);assert.equal(r.evidence_summary.inferred,1);assert.equal(r.evidence_summary.calibrated,false);
 const duplicate={...source,id:'duplicate'},repeated=validateDetails(result(row({source_ids:['resume-1','duplicate']})),[source,duplicate]);
 assert.equal(repeated.criteria_assessment[0].confidence_score,c.confidence_score,'duplicated evidence increases confidence');
 const unknown=validateDetails(result(row({status:'unknown',evidence_type:'unknown',inference_basis:'',source_ids:[]})),[source]);
 assert.equal(unknown.criteria_assessment[0].confidence_score,0);assert.equal(unknown.criteria_assessment[0].confidence,'low');
});

test('summary-only claims have low confidence and requirements or memory cannot act as candidate evidence',async()=>{
 const {validateDetails}=await api;
 const direct=row({status:'supported',evidence_type:'direct',inference_basis:''});
 const summary=validateDetails(result(direct),[{...source,kind:'profile summary (verify against source)'}]);assert.equal(summary.criteria_assessment[0].confidence,'low');
 const inferredSummary=validateDetails(result(),[{...source,kind:'profile summary (verify against source)'}]);assert.equal(inferredSummary.criteria_assessment[0].confidence,'low');
 for(const kind of ['approved learning','requirement','manager context','approved preference'])assert.throws(()=>validateDetails(result(direct),[{...source,kind}]));
 const duplicate=result();duplicate.criteria_assessment.push(row());assert.throws(()=>validateDetails(duplicate,[source]),e=>e.validationIssue==='criteria_count');
 assert.throws(()=>validateDetails(result(),[source],{criteria:['Kafka','Playwright']}),e=>e.validationIssue==='missing_criterion');
});

test('manager disagreement captures the reason without applying scores and unexplained decisions cannot create lessons',async()=>{
 const {validateDetails}=await api,candidate={jdScore:5,managerScore:4};
 assert.throws(()=>memory.disagreementNote('transfer','',candidate));
 const text=memory.disagreementNote('transfer','Manager validated the RabbitMQ delivery work as transferable to Kafka.',candidate);
 assert.match(text,/Manager explanation: Manager validated/);assert.deepEqual(candidate,{jdScore:5,managerScore:4});
 const feedback={id:'feedback-1',kind:'candidate feedback',text},r=result();
 r.learning_suggestions=[{kind:'evaluation_method',text:'Check messaging delivery semantics when evaluating adjacent queue technologies.',source_ids:['feedback-1']}];
 assert.doesNotThrow(()=>validateDetails(r,[source,feedback],{suggestions:true}));
 assert.throws(()=>validateDetails(r,[source,{...feedback,text:memory.disagreementNote('unexplained','',candidate)}],{suggestions:true}),e=>e.validationIssue==='learning_sources');
});

test('evidence UI shows inference, source text and confidence without mislabeling legacy assessments',async()=>{
 const {validateDetails}=await api;const r=validateDetails(result(),[source]);
 const html=memory.details(r);assert.match(html,/Inferred evidence/);assert.match(html,/Why this may transfer/);assert.match(html,/RabbitMQ/);assert.match(html,/Verify in screening/);assert.match(html,/<meter/);
 r.criteria_assessment[0].evidence[0].quote='<img src=x onerror=alert(1)>';assert.doesNotMatch(memory.details(r),/<img/);
 const legacy=result({criterion:'Kafka',status:'partial',reason:'Verify messaging.',source_ids:[]});
 assert.match(memory.details(legacy),/Earlier assessment/);assert.doesNotMatch(memory.details(legacy),/undefined|Unknown|undefined confidence/);
});

test('reassessment hints use the current candidate original resume and never another candidate feedback',async()=>{
 const {prepare}=await import('../supabase/functions/reassess-job/logic.mjs');
 const p=prepare({job:{id:'j',title:'Engineer',criteria:['Kafka']},candidate:{id:'c',jobId:'j',jdScore:5,managerScore:5},resume_text:source.text,feedback:[{id:'f',jobId:'j',candidateId:'other',text:'Built Kafka clusters.'}]});
 assert.equal(p.payload.transferability_hints[0].target,'kafka');assert.doesNotMatch(JSON.stringify(p.payload),/Built Kafka clusters/);
 assert.equal(p.payload.transferability_hints[0].evidence[0].source_id,'resume-full');
});
