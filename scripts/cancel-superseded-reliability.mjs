// Stop only older runs of this exact workflow on this exact hardening branch.
// This never cancels a deployment, a daily check or another branch's tests.
import assert from 'node:assert/strict';
assert.equal(process.env.GITHUB_REPOSITORY,'ErikFehlan/blumr');
assert.equal(process.env.GITHUB_REF,'refs/heads/hardening/continuous-reliability');
const root='https://api.github.com/repos/ErikFehlan/blumr/actions/runs';
const headers={Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
const request=async(url,method='GET')=>{const r=await fetch(url,{method,headers,signal:AbortSignal.timeout(20000)});assert.ok(r.ok,'Workflow control failed: '+r.status);return r.status===204?null:r.json();};
const current=await request(root+'/'+process.env.GITHUB_RUN_ID);
const page=await request(root+'?branch=hardening%2Fcontinuous-reliability&per_page=30');
for(const run of page.workflow_runs){
 if(run.id===current.id||run.workflow_id!==current.workflow_id||run.head_branch!==current.head_branch||run.created_at>=current.created_at||!['queued','in_progress','pending','waiting'].includes(run.status))continue;
 await request(root+'/'+run.id+'/cancel','POST');console.log('Requested cancellation of superseded reliability run '+run.id+'; its always-run cleanup remains responsible for fixtures.');
}
