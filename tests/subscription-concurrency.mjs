import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
function sql(query){return new Promise((resolve,reject)=>{
 const p=spawn('psql',['-h','localhost','-U','postgres','-d','subscription_foundation','-v','ON_ERROR_STOP=1','-At','-c',query],{env:process.env});
 let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('close',code=>code?reject(Error(err)):resolve(out.trim()));
});}
await sql("delete from subscription_evaluations where account_id='20000000-0000-0000-0000-000000000002';update subscription_periods set rules_limit=3 where account_id='20000000-0000-0000-0000-000000000002';");
const reserve=key=>`set role service_role;select reserve_subscription_evaluation('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','rules','${key}',gen_random_uuid())->>'allowed';`;
const results=await Promise.all(Array.from({length:16},(_,i)=>sql(reserve(i.toString(16).padStart(64,'0')))));
// Read only after stdio closes; process exit can precede the final output.
const persisted=await sql("select count(*) from subscription_evaluations where account_id='20000000-0000-0000-0000-000000000002' and state='reserved'");
assert.equal(persisted,'3','Persisted reservations did not match remaining capacity');
assert.ok(results.every(v=>['true','false'].includes(v.split('\n').at(-1))),'Incomplete SQL process response');
assert.equal(results.filter(v=>v.endsWith('true')).length,3,'Admission responses did not match three persisted reservations');
await sql("delete from subscription_evaluations where account_id='20000000-0000-0000-0000-000000000002'");
const duplicates=await Promise.all(Array.from({length:16},()=>sql(reserve('a'.repeat(64)))));
assert.ok(duplicates.every(v=>['true','false'].includes(v.split('\n').at(-1))),'Incomplete duplicate response');
assert.equal(duplicates.filter(v=>v.endsWith('true')).length,1,'Duplicate logical work had multiple owners');
console.log('PASS: native concurrent capacity and duplicate ownership checks');
