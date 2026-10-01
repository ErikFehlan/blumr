// Real browser sessions and authenticated edge routes; synthetic fixtures only.
const {chromium}=require('playwright');
const fs=require('node:fs/promises'),assert=require('node:assert/strict');
(async()=>{
 const fixture=JSON.parse(await fs.readFile(process.env.LIVE_FIXTURE_FILE,'utf8'));
 assert.equal(fixture.base,'https://zqiqjzxcpznhzjengfff.supabase.co');
 assert.equal(fixture.app,'https://blumr.io/');
 assert.ok(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(fixture.run));
 const owner=fixture.users[0];assert.equal(owner.email,'blumr-live-'+fixture.run+'-0@example.invalid');
 const login=await fetch(fixture.base+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:fixture.anon,'Content-Type':'application/json'},body:JSON.stringify({email:owner.email,password:owner.password})});
 assert.ok(login.ok,'Second device login failed');const second=await login.json();
 const browser=await chromium.launch({headless:true,executablePath:process.env.TEST_CHROME});
 try{
  const contexts=await Promise.all([browser.newContext(),browser.newContext()]);
  const pages=await Promise.all(contexts.map(c=>c.newPage()));
  await Promise.all(pages.map(p=>p.goto(fixture.app,{waitUntil:'domcontentloaded'})));
  const payload={workspace_id:owner.workspace,analysis_type:'feedback',job:{title:'Synthetic duplicate verification'},feedback:{text:'Synthetic '+fixture.run+': verify the candidate personally owned manual regression testing.'}};
  const call=(page,token,body,route='analyze-patterns-beta',abort=false)=>page.evaluate(async args=>{
   const controller=new AbortController();let timer;if(args.abort)timer=setTimeout(()=>controller.abort(),700);
   try{const r=await fetch(args.base+'/functions/v1/'+args.route,{method:'POST',headers:{apikey:args.anon,Authorization:'Bearer '+args.token,'Content-Type':'application/json'},body:JSON.stringify(args.body),signal:controller.signal});return {status:r.status,body:await r.json()};}
   catch(error){if(args.abort&&error.name==='AbortError')return {aborted:true};throw error;}
   finally{clearTimeout(timer);}
  },{base:fixture.base,anon:fixture.anon,token,body,route,abort});
  const same=await Promise.all([call(pages[0],owner.access,payload),call(pages[1],second.access_token,payload,'analyze-patterns-v2')]);
  same.forEach(r=>assert.equal(r.status,200,'Concurrent live analysis failed'));
  assert.deepEqual(same[0].body,same[1].body,'Devices received different analyses');
  const replay=await call(pages[1],second.access_token,payload);assert.deepEqual(replay.body,same[0].body,'Retry regenerated a completed result');
  console.log('PASS: two independent signed-in browser sessions and both edge routes share one result; response retry replays it.');
  const interrupted={...payload,feedback:{text:payload.feedback.text+' Ask for a concrete release checklist example.'}};
  const lost=await call(pages[0],owner.access,interrupted,'analyze-patterns-beta',true);
  assert.ok(lost.aborted||lost.status===200,'Interrupted submission failed before it could run');
  await pages[0].close();
  const recovered=await call(pages[1],second.access_token,interrupted);
  assert.equal(recovered.status,200,'Second device did not recover the interrupted submission');
  assert.notEqual(recovered.body.generated_at,same[0].body.generated_at,'Changed evidence reused an old result');
  const repeated=await call(pages[1],second.access_token,interrupted);assert.deepEqual(repeated.body,recovered.body,'Recovered request was charged again');
  console.log('PASS: interrupted browser request recovers in another session; changed evidence gets a new result; repeated recovery replays it.');
  const foreign=await call(pages[1],fixture.users[1].access,payload);assert.equal(foreign.status,403,'Foreign workspace used cached evidence');
  console.log('PASS: another account cannot read the cached result.');
  await fetch(fixture.base+'/auth/v1/logout?scope=local',{method:'POST',headers:{apikey:fixture.anon,Authorization:'Bearer '+second.access_token}});
 }finally{await browser.close();}
})().catch(error=>{console.error('FAIL:',error.message);process.exitCode=1;});
