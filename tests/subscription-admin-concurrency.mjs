import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
function sql(query){return new Promise((resolve,reject)=>{const p=spawn('psql',['-h','localhost','-U','postgres','-d','subscription_admin','-v','ON_ERROR_STOP=1','-At','-c',query],{env:process.env});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('exit',code=>code?reject(Error(err)):resolve(out.trim().split('\n').at(-1)));});}
const user='00000000-0000-0000-0000-000000000006',admin='00000000-0000-0000-0000-000000000005',workspace='10000000-0000-0000-0000-000000000002',ends=new Date(Date.now()+30*86400000).toISOString();
await sql(`insert into auth.users(id,email) values('${user}','concurrent@example.test');insert into workspace_members values('${workspace}','${user}');
create function test_admin_request(request uuid,version text) returns text language plpgsql as $$begin
 perform admin_change_subscription(request,'${user}',version,'save','advanced-v1','beta','${ends}','Concurrent synthetic trial access');return 'saved';
exception when sqlstate 'PT409' then return 'conflict';end$$;`);
const call=(id,version)=>`set test.actor='${admin}';set role authenticated;select test_admin_request('${id}','${version}');`;
const first=await Promise.all(Array.from({length:12},()=>sql(call(randomUUID(),'unassigned'))));
assert.equal(first.filter(x=>x==='saved').length,1,'Concurrent first grants created multiple accounts/periods');
assert.equal(await sql(`select count(*) from subscription_periods where account_id=(select id from subscription_accounts where user_id='${user}')`),'1');
const version=await sql(`set test.actor='${admin}';set role authenticated;select admin_get_subscription('concurrent@example.test')->>'version';`),request=randomUUID();
const retries=await Promise.all(Array.from({length:12},()=>sql(call(request,version))));assert.ok(retries.every(x=>x==='saved'),'Same request did not replay successfully');
assert.equal(await sql(`select count(*) from subscription_admin_changes where user_id='${user}'`),'2','Replay created extra audit changes');
// Administration and allowance reservations use the same short account lock.
const current=await sql(`set test.actor='${admin}';set role authenticated;select admin_get_subscription('concurrent@example.test')->>'version';`);
const reserve=i=>sql(`set role service_role;select reserve_subscription_evaluation('${workspace}','${user}','rules','${i.toString(16).padStart(64,'0')}',gen_random_uuid())->>'allowed';`);
await Promise.all([sql(call(randomUUID(),current)),...Array.from({length:12},(_,i)=>reserve(i+1))]);
assert.equal(await sql(`select count(*) from subscription_evaluations where account_id=(select id from subscription_accounts where user_id='${user}') and state='reserved'`),'12','Admin save lost concurrent usage');
assert.equal(await sql(`select count(*) from subscription_periods where account_id=(select id from subscription_accounts where user_id='${user}')`),'1','Admin update reset the active period');
console.log('PASS: simultaneous first grants, response-loss replays, optimistic conflicts and administration alongside allowance reservations');
