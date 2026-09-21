// Run only after a successful main release, and wait for the same Cloudflare commit.
import {appendFile,readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {APP_URL} from './live-test-safety.mjs';
const sha=process.env.EXPECTED_SHA,repo=process.env.GITHUB_REPOSITORY,token=process.env.GITHUB_TOKEN;
if(repo!=='ErikFehlan/blumr'||!/^[a-f0-9]{40}$/.test(sha||'')||!token)throw Error('Invalid trusted release context');
const output=value=>appendFile(process.env.GITHUB_OUTPUT,`ready=${value}\n`);
async function github(path){const r=await fetch(`https://api.github.com/repos/${repo}/${path}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Release lookup failed: '+r.status);return r.json();}
const paths=['index.html',...(await readdir('assets')).filter(f=>/\.(js|css)$/.test(f)).map(f=>'assets/'+f)];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
let ready=false;
for(let attempt=0;attempt<12;attempt++){
 if((await github('git/ref/heads/main')).object.sha!==sha){
  await output(false);console.log('SKIPPED: a newer main commit superseded this release.');
  await appendFile(process.env.GITHUB_STEP_SUMMARY,'Live tests skipped: a newer release superseded this commit.\n');process.exit(0);
 }
 const checks=(await github(`commits/${sha}/check-runs`)).check_runs.filter(c=>c.name==='Cloudflare Pages');
 if(checks.some(c=>c.status==='completed'&&c.conclusion==='failure'))throw Error('Cloudflare deployment failed');
 if(checks.some(c=>c.status==='completed'&&c.conclusion==='success')){
  try{
   for(let offset=0;offset<paths.length;offset+=5){
    await Promise.all(paths.slice(offset,offset+5).map(async path=>{
     const url=new URL(path==='index.html'?'':path,APP_URL);url.searchParams.set('live-check',sha);
     const r=await fetch(url,{signal:AbortSignal.timeout(15000),cache:'no-store'});
     if(!r.ok||new URL(r.url).origin!==new URL(APP_URL).origin)throw Error('Live asset unavailable');
     if(digest(Buffer.from(await r.arrayBuffer()))!==digest(await readFile(path)))throw Error('Live assets have not reached this commit');
    }));
   }
   ready=true;break;
  }catch{console.log('Waiting for the custom domain to serve the deployed version.');}
 }
 await new Promise(resolve=>setTimeout(resolve,10000));
}
if(!ready)throw Error('Could not verify this Cloudflare release on blumr.io; no test accounts were created');
await output(true);console.log(`PASS: Cloudflare deployment and ${paths.length} served files match ${sha}.`);
