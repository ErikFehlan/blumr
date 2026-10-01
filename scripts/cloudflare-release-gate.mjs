import {pathToFileURL} from 'node:url';
export function releaseDecision(checks){
 const names=['core-backend / validate','core-backend / deploy','staging / verify'];
 const validate=checks.filter(c=>c.name==='validate');
 const required=[...validate,...names.flatMap(name=>checks.filter(c=>c.name===name))];
 if(required.some(c=>c.status==='completed'&&c.conclusion!=='success'))return 'failed';
 if(validate.length<2||names.some(name=>!checks.some(c=>c.name===name)))return 'pending';
 return required.every(c=>c.status==='completed'&&c.conclusion==='success')?'passed':'pending';
}
export async function enforceRelease({sha,fetcher=fetch,wait=ms=>new Promise(r=>setTimeout(r,ms)),attempts=30,token}={}){
 if(!/^[a-f0-9]{40}$/.test(sha||''))throw Error('Missing trusted commit identity');
 const headers={Accept:'application/vnd.github+json',...(token?{Authorization:'Bearer '+token}:{})};
 for(let n=0;n<attempts;n++){
  const r=await fetcher(`https://api.github.com/repos/ErikFehlan/blumr/commits/${sha}/check-runs?filter=latest&per_page=100`,{headers,signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('Release evidence unavailable: HTTP '+r.status);
  const state=releaseDecision((await r.json()).check_runs||[]);
  if(state==='failed')throw Error('Required release checks failed; production publication blocked');
  if(state==='passed')return;
  if(n<attempts-1)await wait(30000);
 }
 throw Error('Required release checks did not finish; production publication blocked');
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 if(process.env.CF_PAGES_BRANCH!=='main')throw Error('Production gate requires main');
 await enforceRelease({sha:process.env.CF_PAGES_COMMIT_SHA,token:process.env.GITHUB_TOKEN});
 console.log('PASS: staging, application, database and backend checks authorize this production commit');
}
