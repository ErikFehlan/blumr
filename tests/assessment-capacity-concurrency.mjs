import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
function sql(query) {
 return new Promise((resolve,reject)=>{
  const p=spawn('psql',['-h','localhost','-U','postgres','-d','assessment_capacity','-v','ON_ERROR_STOP=1','-At','-c',query],{env:process.env});
  let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);
  p.on('error',reject);p.on('exit',code=>code?reject(Error(err)):resolve(out.trim()));
 });
}
const reset=()=>sql("truncate direct_ai_requests;update resume_intake_tasks set status='queued',attempts=0,lease_id=null,lease_until=null;update job_reassessment_tasks set status='queued',attempts=0,lease_id=null,lease_until=null;");
function claim(i,n) {
 const query=i%3===0?`select count(*) from claim_resume_intakes((select j from capacity_fixtures where n=${n}));`
  :i%3===1?`select count(*) from claim_job_reassessments((select j from capacity_fixtures where n=${n}));`
  :`select claim_direct_ai_request(w,a,repeat(md5('${i}'),2),gen_random_uuid())->>'state' from capacity_fixtures where n=${n};`;
 return sql('set role service_role;'+query);
}
await reset();
await Promise.all(Array.from({length:24},(_,i)=>claim(i,1)));
assert.equal(await sql('select active_assessment_count(w) from capacity_fixtures where n=1;'),'3','Mixed routes over-admitted one workspace');
assert.equal(await sql("select count(*) from (select attempts from resume_intake_tasks where status='queued' union all select attempts from job_reassessment_tasks where status='queued') q where attempts<>0;"),'0','Capacity waiting consumed attempts');
await reset();
await Promise.all(Array.from({length:36},(_,i)=>claim(i,1+Math.floor(i/3)%3)));
assert.equal(await sql('select active_assessment_count(null);'),'6','Mixed routes exceeded or failed to fill the global limit');
assert.equal(await sql('select bool_and(active_assessment_count(w)<=3) from capacity_fixtures;'),'t','Concurrent workspace limit exceeded');
assert.equal(await sql("select count(*)<=2 from resume_intake_tasks where status='processing';"),'t','Intake global limit exceeded');
assert.equal(await sql("select count(*)<=4 from job_reassessment_tasks where status='processing';"),'t','Reassessment global limit exceeded');
await reset();
// Full workspace 1 must not make a global batch skip work for workspace 2.
await sql("select claim_direct_ai_request(w,a,repeat(k::text,64),gen_random_uuid()) from capacity_fixtures cross join generate_series(1,3) k where n=1;");
await sql('select count(*) from claim_resume_intakes();');
assert.equal(await sql('select active_assessment_count(w) from capacity_fixtures where n=1;'),'3');
assert.equal(await sql('select active_assessment_count(null);'),'5','Global queue stalled behind a full workspace');
await reset();
console.log('PASS: 24 same-workspace and 36 mixed-workspace concurrent claims; shared limits, waiting attempts and queue progress verified.');
