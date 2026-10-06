import {handleAnalysis} from '../supabase/functions/analyze-patterns-v2/analysis.ts';
function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
Deno.test('intake and screening send grounded transferability hints and return bounded, cited inference findings',async()=>{
 const oldFetch=globalThis.fetch,oldKey=Deno.env.get('OPENAI_API_KEY');Deno.env.set('OPENAI_API_KEY','synthetic');
 let current='resume',calls=0;
 const text='Synthetic Candidate\nEngineer\nBuilt RabbitMQ and Azure Service Bus consumers with retries and dead-letter queues.';
 globalThis.fetch=async(_url,init)=>{
  calls++;const body=JSON.parse(String(init?.body)),payload=JSON.parse(body.input.slice(body.input.indexOf('{')));
  const hint=payload.transferability_hints.find((h:any)=>h.target==='kafka');assert(hint?.evidence.length,'missing original-source transfer hint');
  assert(body.instructions.includes('partial credit'),'transferability scoring guidance missing');
  const id=current==='resume'?payload.resume_sources[0].id:'screening-notes';
  const finding={criterion:'Kafka',status:'partial',evidence_type:'inferred',confidence:'high',inference_basis:'Related messaging tools support transferable delivery concepts.',reason:'Direct Kafka experience remains unverified.',source_ids:[id]};
  const common={criteria_assessment:[finding],feedback_impact:{effect:current==='resume'?'initial':'confirmation',summary:'Transferable messaging concepts need verification.',source_ids:[id]},applied_lessons:[],manager_score:6,jd_reason:'Messaging concepts transfer.',manager_reason:'Verify Kafka-specific usage.'};
  const result=current==='resume'?{...common,name:'Synthetic Candidate',role:'Engineer',score:6,primary_signal:'Messaging implementation experience.',concerns:['Direct Kafka usage remains unverified.'],tags:[],screening_questions:['Which Kafka workflows have you used?'],resume_evidence:[{claim:'Built messaging consumers.',source_id:id}]}:{...common,jd_score:6,confidence:'high',summary:'Messaging concepts transfer.'};
  return new Response(JSON.stringify({output_text:JSON.stringify(result)}));
 };
 try{
  for(const mode of ['resume','screening']){
   current=mode;
   const input={analysis_type:mode,auto_intake:true,resume_text:text,job:{title:'Engineer',criteria:['Kafka']},evaluation_context:{requirements:['Kafka'],sources:[]},screening:{notes:text}};
   const response=await handleAnalysis(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify(input)}));
   const out=await response.json();assert(response.ok,'valid inferred assessment rejected');
   const finding=out.criteria_assessment[0];assert(finding.confidence_score<=70&&finding.confidence==='medium','inferred confidence unbounded');
   assert(finding.evidence[0].quote.includes('RabbitMQ'),'original source missing');assert(finding.verification_question,'screening question missing');assert(out.evidence_summary.inferred===1,'coverage lost');
  }
  assert(calls===2,'valid inference required additional provider calls');
 }finally{globalThis.fetch=oldFetch;oldKey===undefined?Deno.env.delete('OPENAI_API_KEY'):Deno.env.set('OPENAI_API_KEY',oldKey);}
});
