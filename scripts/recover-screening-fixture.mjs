// Recover ONLY the known synthetic run whose hosted runner lost its manifest.
// Exact identifiers, synthetic email, ownership, membership and object ownership
// must all match. Other readiness runs and user data are outside this recovery.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {fixtures,STAGING} from './readiness-fixtures.mjs';
const run='6c60247b-02c6-4ebc-8467-b97c00ff4b47',userId='bac0a820-2ef2-4e1c-86f4-d5377c694ebb',workspace='c9f980d7-d34b-4a53-b04e-e9e34d3771b8';
const f=await fixtures();assert.ok(!f.state,'Existing manifest must be cleaned before recovery');
const email=`blumr-readiness-${run}-0@example.invalid`;
const users=await f.sql("select id from auth.users where email=$1 and raw_user_meta_data->>'readiness_run'=$2",[email,run]);
if(users.length){
 assert.equal(users.length,1);assert.equal(users[0].id,userId);
 const spaces=await f.sql('select id from public.workspaces where owner_id=$1',[userId]);assert.deepEqual(spaces,[{id:workspace}]);
 const members=await f.sql('select user_id from public.workspace_members where workspace_id=$1',[workspace]);assert.deepEqual(members,[{user_id:userId}]);
 const objects=await f.sql("select name,owner_id from storage.objects where bucket_id='resumes' and name like $1",[workspace+'/%']);
 assert.ok(objects.every(o=>o.owner_id===userId&&new RegExp('^'+workspace+'/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\\.txt$').test(o.name)),'Unexpected object; refusing recovery');
 await writeFile(process.env.READINESS_STATE_FILE,JSON.stringify({project:STAGING,run,users:[{id:userId,email,workspace,paths:objects.map(o=>o.name)}]}),{flag:'wx',mode:0o600});
 await (await fixtures()).cleanup();
 console.log('PASS: known failed screening fixture recovered');
}else console.log('PASS: known failed screening fixture already absent');
