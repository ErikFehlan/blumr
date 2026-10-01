// Avoid management-API contention without sharing a one-pending-job lock.
import {appendFile} from 'node:fs/promises';
const repo=process.env.GITHUB_REPOSITORY,sha=process.env.EXPECTED_SHA,token=process.env.GITHUB_TOKEN;
if(repo!=='ErikFehlan/blumr'||!/^[a-f0-9]{40}$/.test(sha||'')||!token)throw Error('Invalid release wait context');
async function get(path){const r=await fetch(`https://api.github.com/repos/${repo}/${path}`,{headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Release status lookup failed: '+r.status);return r.json();}
for(let attempt=0;attempt<90;attempt++){
 if((await get('git/ref/heads/main')).object.sha!==sha){
  await appendFile(process.env.GITHUB_OUTPUT,'superseded=true\n');console.log('SKIPPED: a newer main commit superseded this canary');process.exit(0);
 }
 const runs=(await get('actions/runs?head_sha='+sha+'&per_page=30')).workflow_runs.filter(r=>r.name==='Validate and deploy GitHub Pages'&&r.event==='push');
 const latest=runs.sort((a,b)=>b.run_attempt-a.run_attempt)[0];
 if(latest?.status==='completed'){
  if(latest.conclusion!=='success')throw Error('Matching release did not pass; no load fixtures created');
  console.log('PASS: matching release completed before the production load canary');process.exit(0);
 }
 await new Promise(resolve=>setTimeout(resolve,10000));
}
throw Error('Matching release wait expired; no load fixtures created');
