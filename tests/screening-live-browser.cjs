// A small post-activation check on the real domain. No deep AI is requested.
const assert=require('node:assert/strict'),fs=require('node:fs/promises');
const {chromium}=require('playwright');
(async()=>{
 const fixture=JSON.parse(await fs.readFile(process.env.LIVE_FIXTURE_FILE,'utf8'));
 const rollout=JSON.parse(await fs.readFile(process.env.LIVE_FIXTURE_FILE+'.screening','utf8'));
 assert.equal(fixture.app,'https://blumr.io/');assert.equal(fixture.project,'zqiqjzxcpznhzjengfff');assert.equal(rollout.project,fixture.project);
 const [owner,other]=fixture.users;
 // The preceding recruiter journey tests global sign-out and password recovery.
 // Its saved access tokens are revoked; authenticate both disposable accounts
 // again so the route and cross-workspace checks use valid current sessions.
 for(const user of [owner,other]){
  const response=await fetch(fixture.base+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:fixture.anon,'Content-Type':'application/json'},body:JSON.stringify({email:user.email,password:user.password}),signal:AbortSignal.timeout(30000)});
  assert.ok(response.ok,'Synthetic screening account could not sign in');
  const session=await response.json();assert.equal(session.user?.id,user.id);assert.ok(session.access_token);
  user.access=session.access_token;if(process.env.GITHUB_ACTIONS)console.log('::add-mask::'+user.access);
 }
 const request=async(user,path,body)=>{
  const r=await fetch(fixture.base+path,{method:body?'POST':'GET',headers:{apikey:fixture.anon,Authorization:'Bearer '+user.access,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
  return {status:r.status,ok:r.ok,data:await r.json().catch(()=>null)};
 };
 const capabilities=await request(owner,'/rest/v1/rpc/screening_capabilities',{});assert.ok(capabilities.ok&&capabilities.data.enabled);
 let route;for(let attempt=0;attempt<10;attempt++){route=await request(owner,'/functions/v1/analyze-patterns-beta',{analysis_type:'rules_screening',workspace_id:owner.workspace});if(route.status!==404)break;await new Promise(resolve=>setTimeout(resolve,2000));}assert.equal(route.status,400);assert.equal(route.data.code,'invalid_screening_request');
 const {qualificationPools}=await import('./fixtures/screening-qualification-pools.mjs');const pool=qualificationPools.find(p=>p.id==='qa');
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();page.setDefaultTimeout(30000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(fixture.app,{waitUntil:'domcontentloaded'});await page.locator('.an-header [data-auth-mode="signin"]').click();
  await page.locator('#authEmail').fill(owner.email);await page.locator('#authPassword').fill(owner.password);await page.locator('#authSubmit').click();await page.locator('#page-home.active').waitFor({timeout:60000});
  const nav=async name=>{const group=page.locator('.rf-nav details').filter({has:page.locator(`[data-page="${name}"]`)});if(await group.count()&&await group.getAttribute('open')===null)await group.locator('summary').click();await page.locator(`.rf-nav [data-page="${name}"]`).click();await page.locator(`#page-${name}.active`).waitFor();};
  await nav('jobs');await page.locator(`[data-activate-job="${rollout.job}"]`).click();await nav('candidates');
  assert.equal(await page.locator('#screeningMode').inputValue(),'bulk');
  await page.locator('#resumeUpload').setInputFiles([0,1].map(i=>({name:`Synthetic-Release-${i}.txt`,mimeType:'text/plain',buffer:Buffer.from(pool.candidates[i].text+'\nRelease '+i)})));
  await page.getByText('Screening complete for this batch',{exact:true}).waitFor({timeout:120000});
  const batches=await request(owner,'/rest/v1/screening_batches?select=id&job_id=eq.'+rollout.job);assert.ok(batches.ok);assert.equal(batches.data.length,1);
  const batch=batches.data[0].id;
  const ranked=await request(owner,'/functions/v1/analyze-patterns-beta',{analysis_type:'bulk_screening',workspace_id:owner.workspace,batch_id:batch,action:'status'});
  assert.ok(ranked.ok);assert.equal(ranked.data.status,'complete');assert.equal(ranked.data.total,2);assert.equal(ranked.data.ai_calls_for_rules,0);assert.equal(ranked.data.cost.provider_calls_reserved,0);assert.deepEqual(ranked.data.batch.selected_ids,[]);
  const documents=await request(owner,'/rest/v1/candidate_documents?select=file_name,file_size,extracted_text&job_id=eq.'+rollout.job);assert.ok(documents.ok);assert.equal(documents.data.length,2);
  for(let i=0;i<2;i++){const original=pool.candidates[i].text+'\nRelease '+i,doc=documents.data.find(d=>d.file_name===`Synthetic-Release-${i}.txt`);assert.equal(doc?.extracted_text,original);assert.equal(doc.file_size,Buffer.byteLength(original));}
  const tasks=await request(owner,'/rest/v1/resume_intake_tasks?select=candidate_id&job_id=eq.'+rollout.job);assert.ok(tasks.ok);assert.deepEqual(tasks.data,[]);
  const forbidden=await request(other,'/rest/v1/rpc/screening_batch_snapshot',{p_batch:batch});assert.ok(!forbidden.ok);assert.deepEqual(errors,[]);
  await fs.mkdir('test-results/live',{recursive:true});await page.screenshot({path:'test-results/live/bulk-screening.png'});
  await fs.writeFile('test-results/live/screening.json',JSON.stringify({passed:true,site:fixture.app,unique_candidates:2,rules_provider_calls:0,paid_tasks:0,workspace_isolation:true}));
  console.log('PASS: production bulk UI, saved originals, complete rules ranking, zero paid intake tasks, and cross-workspace isolation.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
