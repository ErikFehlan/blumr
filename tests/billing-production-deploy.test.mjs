import test from 'node:test';
import assert from 'node:assert/strict';
import {validateHistory,validateReleaseEvidence} from '../scripts/billing-production-deploy.mjs';
test('migration release refuses changed SQL, unknown billing migrations and partial completion',()=>{
 const manifest=[{version:'20261028134006',name:'subscription_foundation',md5:'original',cli_md5:'split'}];
 for(const md5 of ['original','split'])assert.doesNotThrow(()=>validateHistory([{...manifest[0],md5}],manifest,{complete:true}));
 for(const rows of [[{...manifest[0],md5:'changed'}],[{...manifest[0],name:'subscription_other'}],[]])assert.throws(()=>validateHistory(rows,manifest,{complete:true}));
 assert.doesNotThrow(()=>validateHistory([],manifest));
});
test('release requires the exact verified fresh backup and all matching-commit CI results',()=>{
 const now=Date.parse('2026-10-29T21:00:00Z'),head='a'.repeat(40);
 const run={id:40945589186,conclusion:'success',status:'completed',head_sha:'f5a55455ca004636bd1c087e6981783fcc43a4d3',path:'.github/workflows/independent-backup.yml'};
 const artifact={id:12928364091,expired:false,digest:'sha256:bdf96959604b694953bd69489e6ccd310edfb3c37ba1fb0c0276820081077efb',created_at:'2026-10-29T20:08:55Z'};
 const runs=['Validate and deploy GitHub Pages','Validate subscription foundation','Validate criteria automation backend','Validate rules screening foundation'].map(name=>({name,head_sha:head,status:'completed',conclusion:'success'}));
 assert.doesNotThrow(()=>validateReleaseEvidence(run,artifact,runs,head,now));
 for(const [r,a,ci] of [[{...run,conclusion:'failure'},artifact,runs],[run,{...artifact,expired:true},runs],[run,{...artifact,created_at:'2026-10-27T20:00:00Z'},runs],[run,artifact,runs.slice(1)],[run,artifact,runs.map(r=>({...r,head_sha:'b'.repeat(40)}))]])assert.throws(()=>validateReleaseEvidence(r,a,ci,head,now));
});
