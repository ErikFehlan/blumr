import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
function sql(query){return new Promise((resolve,reject)=>{
 const p=spawn('psql',['-h','localhost','-U','postgres','-d','subscription_screening','-v','ON_ERROR_STOP=1','-At','-c',query],{env:process.env});
 let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('exit',code=>code?reject(Error(err)):resolve(out.trim()));
});}
const scope="set test.workspace='00000000-0000-0000-0000-000000000001';set test.actor='00000000-0000-0000-0000-000000000001';set test.role='authenticated';";
const account="'20000000-0000-0000-0000-000000000001'";
const batches=(await sql(scope+`create table subscription_race_batches as select n,subscription_fixture(1) as batch from generate_series(1,17) n;select batch from subscription_race_batches order by n;`)).split('\n').filter(v=>/^[a-f0-9-]{36}$/.test(v));
assert.equal(batches.length,17);
const used=Number(await sql(`select count(*) from subscription_evaluations where account_id=${account} and metric='rules' and period_id=(select current_period_id from subscription_accounts where id=${account}) and state in ('reserved','succeeded','uncertain')`));
await sql(`update subscription_periods set rules_limit=${used+3} where id=(select current_period_id from subscription_accounts where id=${account});`);
const score=b=>sql(`set test.role='service_role';set role service_role;select subscription_rules_fixture('${b}');`);
const races=await Promise.allSettled(batches.slice(0,16).map(score));
assert.equal(races.filter(r=>r.status==='fulfilled').length,3,'Concurrent result saves overspent the allowance');
for(const r of races.filter(r=>r.status==='rejected'))assert.match(r.reason.message,/evaluation_allowance_exhausted/,'Unexpected SQL failure');
assert.equal(await sql('select count(*) from candidate_screening_cache c join screening_batches b on b.job_id=c.job_id join subscription_race_batches r on r.batch=b.id'),'3','Exhausted result pages partially committed');
await sql(`update subscription_periods set rules_limit=${used+4} where id=(select current_period_id from subscription_accounts where id=${account});`);
await Promise.all(Array.from({length:16},()=>score(batches[16])));
assert.equal(await sql(`select count(*) from subscription_evaluations where account_id=${account} and metric='rules' and state='succeeded' and period_id=(select current_period_id from subscription_accounts where id=${account})`),String(used+4),'Concurrent retries charged the same result twice');
console.log('PASS: concurrent rules result transactions preserve last credits and deduplicate replay');
