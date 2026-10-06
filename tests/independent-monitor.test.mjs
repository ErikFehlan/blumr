import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collect,publicStatus,MonitorState} from '../scripts/operations/worker.mjs';
const now=Date.now();
const good={snapshot:{queued_over_15m:0,failed_last_24h:0,expired_workers:0,uncertain_workers:0,uncertain_direct:0,client_tables_without_rls:0,exposed_worker_functions:0,active_schedulers:2,private_resumes:true},backup:{completed_at:new Date(now).toISOString(),conclusion:'success',artifact:true}};
test('site success cannot conceal an unavailable health endpoint',async()=>{
 const result=await collect({MONITOR_TOKEN:'secret'},async url=>url.includes('functions')?new Response('',{status:503}):new Response('blumr assets/startup.js'),now);
 assert.equal(result.healthy,false);assert.ok(result.failures.includes('health_endpoint_unavailable'));
});
test('aggregate checks fail on stale backup and expired heartbeat',async()=>{
 const fetcher=async url=>url.includes('functions')?Response.json(good):new Response('blumr assets/startup.js');
 const result=await collect({},fetcher,now);assert.equal(result.healthy,true);assert.equal(result.alerts_configured,false);
 assert.equal(publicStatus(result,now+600001).healthy,false);
 assert.equal(publicStatus(undefined,now).heartbeat_fresh,false);
 const old=structuredClone(good);old.backup.completed_at=new Date(now-37*3600000).toISOString();
 const failed=await collect({},async url=>url.includes('functions')?Response.json(old):new Response('blumr assets/startup.js'),now);
 assert.ok(failed.failures.includes('verified_backup_missing_or_stale'));
});
test('missed-check watchdog durably records an incident without pretending it was delivered',async()=>{
 const data=new Map([['current',{healthy:true,checked_at:now-900000}]]);let nextAlarm;
 const monitor=new MonitorState({storage:{get:async k=>data.get(k),put:async(k,v)=>data.set(k,v),setAlarm:async x=>{nextAlarm=x;}}},{});
 await monitor.alarm();assert.equal(data.get('pending_notification').kind,'monitor_missed');assert.ok(nextAlarm>Date.now());
});

import {deliver} from '../scripts/operations/notifications.mjs';
test('lost email acknowledgements retain one idempotency key and expire safely',async()=>{
 const event={id:'fixed-event',created_at:now,kind:'incident',failures:['site_unavailable']};
 const env={RESEND_API_KEY:'fake',ALERT_FROM:'monitor@example.invalid',ALERT_TO:'owner@example.invalid'};
 const keys=[];let attempts=0;
 const fetcher=async(_url,init)=>{keys.push(new Headers(init.headers).get('Idempotency-Key'));if(++attempts===1)throw Error('lost acknowledgement');return Response.json({id:'accepted-event'});};
 assert.equal((await deliver(event,env,fetcher,now)).status,'retry');
 assert.equal((await deliver(event,env,fetcher,now)).status,'accepted');assert.deepEqual(keys,['blumr-operations/fixed-event','blumr-operations/fixed-event']);
 assert.equal((await deliver(event,env,fetcher,now+24*3600000)).status,'manual_review');assert.equal(attempts,2);
});
