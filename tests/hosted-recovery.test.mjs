import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateTarget} from '../scripts/hosted-recovery-preflight.mjs';
const ref='abcdefghijklmnopqrst',org='approved-organization',now=Date.now();
const target={id:ref,organization_id:org,name:'blumr-recovery-rehearsal',status:'ACTIVE_HEALTHY',created_at:new Date(now-60000).toISOString()};
const empty={application_tables:0,users:0,objects:0,active_schedulers:0,vault_secrets:0};
test('hosted recovery refuses existing environments, nonempty targets and wrong organizations',()=>{
 assert.equal(validateTarget(target,ref,org,empty,now),true);
 for(const protectedRef of ['zqiqjzxcpznhzjengfff','momfzjmycveqginxmqib'])assert.throws(()=>validateTarget({...target,id:protectedRef},protectedRef,org,empty,now));
 for(const key of Object.keys(empty))assert.throws(()=>validateTarget(target,ref,org,{...empty,[key]:1},now));
 assert.throws(()=>validateTarget(target,ref,'other-organization',empty,now));
 assert.throws(()=>validateTarget({...target,name:'live-app'},ref,org,empty,now));
 assert.throws(()=>validateTarget({...target,created_at:new Date(now-8*86400000).toISOString()},ref,org,empty,now));
});
