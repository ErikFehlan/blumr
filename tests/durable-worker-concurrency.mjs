import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
function sql(query){return new Promise((resolve,reject)=>{
 const p=spawn('psql',['-h','localhost','-U','postgres','-d','durable_worker_recovery','-v','ON_ERROR_STOP=1','-At','-c',query],{env:process.env});
 let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('exit',code=>code?reject(Error(err)):resolve(out.trim()));
});}
const reset=()=>sql("truncate assessment_worker_attempts,direct_ai_requests;update resume_intake_tasks set status='queued',attempts=0,lease_id=null,lease_until=null,next_run_at=now();update job_reassessment_tasks set status='queued',attempts=0,lease_id=null,lease_until=null,next_run_at=now();");
function claim(i,n){return sql(i%3===2?`select claim_direct_ai_request(w,a,repeat(md5('${i}'),2),gen_random_uuid())->>'state' from capacity_fixtures where n=${n};`:`select jsonb_array_length(claim_assessment_work('${i%3===0?'intake':'reassessment'}',(select j from capacity_fixtures where n=${n})));`);}
await reset();await Promise.all(Array.from({length:24},(_,i)=>claim(i,1)));
assert.equal(await sql('select active_assessment_count(w) from capacity_fixtures where n=1;'),'3');
await reset();await Promise.all(Array.from({length:36},(_,i)=>claim(i,1+Math.floor(i/3)%3)));
assert.equal(await sql('select active_assessment_count(null);'),'6');
assert.equal(await sql('select bool_and(active_assessment_count(w)<=3) from capacity_fixtures;'),'t');
await reset();
await sql("select claim_assessment_work('intake',null);");
const lease=await sql("select lease_id from assessment_worker_attempts where kind='intake' and state='reserved' limit 1;");
const starts=await Promise.all(Array.from({length:24},()=>sql(`select begin_assessment_provider('${lease}',gen_random_uuid());`)));
assert.equal(starts.filter(x=>x==='t').length,1,'Concurrent duplicate worker started multiple provider calls');
// Editing the job while competing claims arrive must retain the started slot.
await Promise.all([sql(`update jobs set manager_feedback='Concurrent revised priority' where id=(select job_id from assessment_worker_attempts where lease_id='${lease}');`),...Array.from({length:12},()=>sql("select claim_assessment_work('intake',null);"))]);
assert.equal(await sql(`select count(*) from assessment_worker_attempts where candidate_id=(select candidate_id from assessment_worker_attempts where lease_id='${lease}') and state<>'closed';`),'1');
assert.equal(await sql(`select begin_assessment_provider('${lease}',gen_random_uuid());`),'f');
await sql(`select end_assessment_provider('${lease}',(select provider_call from assessment_worker_attempts where lease_id='${lease}'));`);
assert.equal(await sql(`select finish_assessment_work('${lease}',valid_intake_result());`),'f','Superseded result accepted');
await reset();
console.log('PASS: concurrent mixed admission, 24-way provider-start race, and source-edit/claim overlap.');
