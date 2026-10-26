// Browser extraction + actual deterministic engine. Database/provider transport
// is simulated here; real database permissions are tested in bulk-screening.sql.
const {chromium}=require('playwright'),fs=require('fs'),http=require('http'),path=require('path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const Zip=require('../assets/vendor/jszip-3.10.1.min.js'),dir=path.resolve(__dirname,'..');
(async()=>{
 const {processBulkScreeningBatch,summarizeBulkScreening}=await import('../supabase/functions/_shared/bulk-screening.ts');
 const {qualificationPools,qualificationJob}=await import('./fixtures/screening-qualification-pools.mjs');
 const pool=qualificationPools.find(p=>p.id==='qa'),source={...qualificationJob(pool,'workspace','job-a'),workspaceId:'workspace',feedback:[],assessments:[],lessons:[],sourceVersion:'source'};
 let batch=null,docs=new Map(),candidates=new Map(),failedOnce=false,deepCalls=0,legacyCalls=0,approvals=0,delayCreate=false,releaseCreate,createCalls=0;
 const assessment=c=>({status:'ready',revision:'current',result:{name:'Candidate',score:c.result.score/10,manager_score:c.result.score/10,jd_reason:'Verified synthetic testing evidence.',manager_reason:'No additional manager preferences supplied.',resume_evidence:[{claim:'Testing work',quote:c.text.split('\n').find(t=>/Performed|Owned/.test(t))||c.text}],concerns:['Verify scope on a phone screen.'],screening_questions:['What testing did you personally own?']}});
 async function operation(op,args){
  if(op==='load')return {jobs:[{id:'job-a',title:'QA Engineer',description:'Perform manual testing.',criteria:[],knockouts:[],weights:[],status:'active',createdAt:1,updatedAt:1},{id:'job-b',title:'Other role',description:'Other job requirements.',criteria:[],knockouts:[],weights:[],status:'active',createdAt:1,updatedAt:1}],candidates:[...candidates.values()].map(c=>({id:c.candidateId,jobId:'job-a',name:c.name,short:c.name,role:c.approved?'QA Engineer':'Resume awaiting analysis',screeningManaged:true,jdScore:c.approved?c.assessment.result.score:0,resumeJDScore:c.approved?c.assessment.result.score:0,managerScore:c.approved?c.assessment.result.manager_score:0,originalManagerScore:0,stage:'Sourced',strengths:[],concerns:[],tags:[],screeningQuestions:[],createdAt:1,updatedAt:1,aiReview:c.approved?{source:'resume_intake',verdict:'Accurate',assessment:c.assessment.result}:null})),feedback:[],interviewOutcomes:[]};
  if(op==='legacy'){legacyCalls++;throw Error('Bulk candidate entered legacy AI intake');}
  if(op==='approve'){const c=candidates.get(args[0]);assert.equal(args[1],c.assessment.revision);c.approved=true;c.assessment.status='approved';approvals++;return true;}
  if(op==='list')return batch&&batch.job_id===args[0]?[batch]:[];
  if(op==='create'){createCalls++;if(delayCreate)await new Promise(resolve=>releaseCreate=resolve);const [id,job,manifest]=args;assert.equal(args.length,3,'Recruiter sent a budget');batch={id,job_id:job,created_at:new Date().toISOString(),sealed:false,selected_ids:[],selection_version:0,budget_usd:5,manifest};batch.items=manifest.map((f,ordinal)=>({ordinal,file_name:f.name,file_size:f.size,status:'pending'}));return id;}
  if(op==='prepare'){const [,ordinal,text]=args,id=crypto.createHash('sha256').update(text.toLowerCase().replace(/\s+/g,' ').trim()).digest('hex').slice(0,32),item=batch.items[ordinal];item.candidate_id=id;
   if(!candidates.has(id))candidates.set(id,{candidateId:id,name:item.file_name,text});return {candidate_id:id,hash:id.padEnd(64,'0'),stored:docs.has(id)};}
  if(op==='upload'){const [c,text,fileName]=args;if(fileName==='retry.txt'&&!failedOnce){failedOnce=true;throw Error('Simulated upload interruption');}docs.set(c.id,text);return 'stored';}
  if(op==='mark'){batch.items[args[1]].status=args[2];return null;}
  if(op==='seal'){if(batch.items.some(i=>['pending','failed'].includes(i.status)))throw Error('Unfinished files');batch.sealed=true;return null;}
  if(op==='refresh'){
   await processBulkScreeningBatch(batch.id,async(name,body)=>{
    if(name==='bulk_screening_source')return source;
    if(name==='bulk_screening_page')return [...candidates.values()].filter(c=>docs.has(c.candidateId)&&!c.result).slice(0,100).map(c=>({candidate_id:c.candidateId,document_id:c.candidateId,resume_hash:'hash',resume_text:c.text}));
    if(name==='save_bulk_screening_page'){batch.source_version=body.p_source;batch.intelligence=body.p_intelligence;for(const r of body.p_rows)candidates.get(r.candidate_id).result=r.result;return true;}throw Error(name);
   });
   return summarizeBulkScreening({batch,items:batch.items,candidates:[...candidates.values()].filter(c=>batch.items.some(i=>i.status==='saved'&&i.candidate_id===c.candidateId)),source_current:true,cost:{provider_calls_reserved:deepCalls,reserved_usd:deepCalls*.02,actual_usd:deepCalls*.01,unsettled_calls:0,budget_usd:batch.budget_usd}});
  }
  if(op==='select'){assert.equal(batch.sealed,true);assert.ok(args[1].length<=20);batch.selected_ids=args[1];batch.selection_version++;for(const id of batch.selected_ids){const c=candidates.get(id);if(!c.assessment){c.assessment=assessment(c);deepCalls++;}}return batch.selection_version;}
  if(op==='text')return docs.get(args[0].id)||'';
  throw Error('Unexpected operation '+op);
 }
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/__bulk'){try{let body='';for await(const part of req)body+=part;const {op,args}=JSON.parse(body);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await operation(op,args)));}catch(e){res.statusCode=409;res.end(JSON.stringify({error:e.message}));}return;}
  const file=path.join(dir,req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0]);res.setHeader('Content-Type',file.endsWith('.js')||file.endsWith('.mjs')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');try{res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}
 }).listen(0,'127.0.0.1');
 let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.TEST_CHROME});let peakPdfWorkers=0;const page=await browser.newPage(),errors=[],pdfWorkers=new Set();page.on('worker',worker=>{pdfWorkers.add(worker);peakPdfWorkers=Math.max(peakPdfWorkers,pdfWorkers.size);worker.on('close',()=>pdfWorkers.delete(worker));});page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://**',r=>r.abort());
  const pdfDir=path.dirname(require.resolve('pdfjs-dist/package.json'));
  await page.route('**/pdfjs-dist@4.10.38/**',r=>r.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(pdfDir,'build',r.request().url().includes('worker')?'pdf.worker.min.mjs':'pdf.mjs'),'utf8')}));
  await page.route('**/mammoth@1.8.0/mammoth.browser.min.js',r=>r.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(path.dirname(require.resolve('mammoth/package.json')),'mammoth.browser.min.js'),'utf8')}));
  await page.route('**/assets/auth.js*',r=>r.fulfill({contentType:'application/javascript',body:"document.body.classList.remove('rf-auth-pending');document.getElementById('authGate').style.display='none';"}));
  await page.route('**/assets/data.js*',r=>r.fulfill({contentType:'application/javascript',body:''}));
  await page.route('**/assets/resume-intake.js*',r=>r.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(dir,'assets/resume-intake.js'),'utf8')+";{const original=window.AncalagonIntake.create;window.AncalagonIntake.create=api=>{window.testExtractLocalResume=api.extract;return original(api);};}"}));
  await page.addInitScript(()=>{
   const rpc=async(op,...args)=>{const r=await fetch('/__bulk',{method:'POST',body:JSON.stringify({op,args})});const value=await r.json();if(!r.ok)throw Error(value.error);return value;};
   window.AncalagonData={create:()=>({load:()=>rpc('load'),requestResumeIntake:()=>rpc('legacy'),loadResumeIntakes:async()=>[],reviewResumeIntake:(...a)=>rpc('approve',...a),schedule:(_,__,done)=>done('saved'),flush:async()=>{},trackEvent:async()=>{},loadAdminAnalytics:async()=>{throw Error('not admin');},
    screeningCapabilities:async()=>({enabled:true}),listScreeningBatches:id=>rpc('list',id),createScreeningBatch:(...a)=>rpc('create',...a),prepareScreeningUpload:(...a)=>rpc('prepare',...a),updateScreeningItem:(...a)=>rpc('mark',...a),sealScreeningBatch:(...a)=>rpc('seal',...a),refreshScreeningBatch:(...a)=>rpc('refresh',...a),selectScreeningFinalists:(...a)=>rpc('select',...a),uploadResume:(c,f,t)=>rpc('upload',c,t,f.name),loadResumeText:c=>rpc('text',c),loadResumeDocument:async()=>null})};
   window.ancalagonAuth={session:{user:{id:'test'},access_token:'test-token'},workspace:{id:'workspace'}};
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.locator('#page-home.active').waitFor();await page.locator('.rf-nav [data-page="candidates"]').click();await page.locator('#screeningMode').waitFor();
  assert.equal(await page.locator('#screeningMode').inputValue(),'bulk');assert.equal(await page.locator('[data-bulk-budget], [data-bulk-current-budget], [data-bulk-save-budget]').count(),0);
  const text=i=>`Synthetic applicant ${i}\nQA Engineer\nPerformed manual testing.\nReproduced defects.\nMaintained regression tests.\nDocumented test cases.\nValidated user acceptance testing.`;
  const zip=new Zip();for(let i=0;i<20;i++)zip.file(i+'.txt',text(i));zip.file('duplicate.txt',text(0));zip.file('Word.docx',await require('./fixtures/docx-resume.cjs')());zip.file('Readable.pdf',require('./fixtures/pdf-resume.cjs')());zip.file('Broken.pdf','%PDF-1.7\nThis synthetic document deliberately has no cross-reference table.');zip.file('retry.txt',text(99));
  const started=performance.now();await page.locator('#resumeUpload').setInputFiles({name:'Applications.zip',mimeType:'application/zip',buffer:await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'})});
  await page.locator('[data-bulk-message]').filter({hasText:/Preparing|Import saved|Reading|Saving/}).waitFor();const ack=performance.now()-started;
  await page.waitForFunction(()=>document.querySelector('[data-bulk-message]')?.textContent.includes('Some files need attention'),{},{timeout:45000});
  assert.equal(pdfWorkers.size,0,'PDF parsing workers leaked after successful or failed documents');assert.equal(batch.budget_usd,5,'Server budget lost');assert.equal(docs.size,22,'Duplicate or readable document handling failed');assert.equal(deepCalls,0,'Upload invoked full AI');assert.equal(batch.sealed,false);assert.match(await page.locator('#bulkScreening').textContent(),/Provisional ranking/);
  assert.ok([...docs.values()].some(t=>t.includes('Documented regression coverage')),'DOCX text box lost');assert.ok([...docs.values()].some(t=>t.includes('Used SQL to validate billing data')),'PDF extraction lost');
  await page.locator('[data-bulk-resume-files]').setInputFiles({name:'retry.txt',mimeType:'text/plain',buffer:Buffer.from(text(99))});
  await page.waitForFunction(()=>document.querySelector('[data-bulk-message]')?.textContent.includes('Files saved'),{},{timeout:15000});
  const broken=batch.items.find(i=>i.file_name==='Broken.pdf');await page.locator(`[data-bulk-exclude="${broken.ordinal}"]`).click();await page.getByText('Screening complete for this batch',{exact:true}).waitFor();
  assert.equal(docs.size,23);assert.equal(deepCalls,0);assert.equal(batch.sealed,true);
  await page.locator('[data-bulk-disclosure="near"]').evaluate(d=>d.open=true);
  await page.locator('[data-bulk-refresh]').click();await page.waitForTimeout(150);
  assert.equal(await page.locator('[data-bulk-disclosure="near"]').evaluate(d=>d.open),true,'Refresh closed evidence review');
  assert.equal(await page.locator('[data-bulk-budget], [data-bulk-current-budget], [data-bulk-save-budget]').count(),0);
  assert.doesNotMatch(await page.locator('#bulkScreening').textContent(),/call reservations|reserved \/|Save higher budget/);
  assert.equal(deepCalls,0,'UI refresh started AI');
  await page.locator('[data-bulk-start]').click();await page.getByRole('heading',{name:'Recommended phone screens',exact:true}).waitFor();assert.equal(deepCalls,20);
  await page.locator('[data-bulk-start]').click();await page.waitForTimeout(250);assert.equal(deepCalls,20,'Repeated shortlist created duplicate model calls');
  const limited=candidates.get(batch.selected_ids[0]),ready=limited.assessment;limited.assessment={status:'failed',error:'screening_budget_limit'};
  await page.locator('[data-bulk-refresh]').click();await page.getByText(/Contact your blumr administrator to review the limit/).waitFor();
  assert.equal(deepCalls,20);assert.equal(await page.locator('[data-bulk-current-budget], [data-bulk-save-budget]').count(),0);
  limited.assessment=ready;await page.locator('[data-bulk-refresh]').click();await page.getByRole('heading',{name:'Recommended phone screens',exact:true}).waitFor();
  await page.locator('[data-bulk-resume]').first().click();await page.locator('dialog[open]').waitFor();assert.ok((await page.locator('[data-resume-text]').textContent()).length>40);await page.locator('dialog [data-close]').click();
  await page.reload();await page.locator('#page-home.active').waitFor();await page.locator('.rf-nav [data-page="candidates"]').click();await page.getByRole('heading',{name:'Recommended phone screens',exact:true}).waitFor();assert.equal(deepCalls,20);
  assert.equal(legacyCalls,0,'Reload started legacy full AI');
  await page.locator('[data-bulk-review]').first().click();await page.locator('#page-detail.active').waitFor();assert.equal(approvals,1);assert.notEqual((await page.locator('#detailJDScore').textContent()).trim(),'—');
  await page.locator('.rf-nav [data-page="candidates"]').click();await page.getByRole('heading',{name:'Recommended phone screens',exact:true}).waitFor();assert.equal(legacyCalls,0);assert.equal(deepCalls,20);
  assert.equal(await page.locator('#candidateCards').isHidden(),true,'Legacy cards remained visible under bulk results');
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile overflow');
  fs.mkdirSync('test-results/bulk-screening',{recursive:true});await page.screenshot({path:'test-results/bulk-screening/mobile.png',fullPage:true});await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'test-results/bulk-screening/desktop.png',fullPage:true});
  // A delayed manifest must not hijack a newly selected job or allow a second
  // import to bypass the one-upload-at-a-time bound.
  delayCreate=true;const requested=page.waitForRequest(r=>r.url().endsWith('/__bulk')&&r.postDataJSON()?.op==='create');
  await page.locator('#resumeUpload').setInputFiles({name:'Job-A-only.txt',mimeType:'text/plain',buffer:Buffer.from(text(2000))});await requested;
  await page.locator('#resumeUpload').setInputFiles({name:'Should-not-start.txt',mimeType:'text/plain',buffer:Buffer.from(text(2001))});await page.waitForTimeout(100);assert.equal(createCalls,2,'Concurrent manifest creation bypassed upload bound');
  await page.evaluate(()=>{const select=document.querySelector('#globalJobSelect');select.value='job-b';select.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.waitForFunction(()=>document.querySelector('#globalJobSelect')?.value==='job-b'&&document.querySelector('[data-bulk-batch]')?.value==='');
  const sealed=page.waitForResponse(r=>r.url().endsWith('/__bulk')&&r.request().postDataJSON()?.op==='seal');releaseCreate();await sealed;await page.waitForTimeout(100);
  assert.equal(batch.job_id,'job-a');assert.equal(await page.locator('[data-bulk-batch]').inputValue(),'','Old import replaced the new job’s batch');assert.equal(deepCalls,20);assert.equal(legacyCalls,0);
  let parsing=null;const parseCount=Number(process.env.BULK_PARSE_COUNT||0);
  if(parseCount){
   assert.ok(Number.isInteger(parseCount)&&parseCount>=20&&parseCount<=1000);peakPdfWorkers=0;
   const inputs={count:parseCount,pdf:Buffer.from(require('./fixtures/pdf-resume.cjs')()).toString('base64'),docx:Buffer.from(await require('./fixtures/docx-resume.cjs')()).toString('base64')};
   parsing=await page.evaluate(async({count,pdf,docx})=>{const bytes=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0)),sources=[bytes(pdf),bytes(docx)],started=performance.now();let pdfs=0,words=0;
    for(let i=0;i<count;i++){const word=i%2===1,file=new File([sources[i%2]],'Synthetic-'+i+(word?'.docx':'.pdf'),{type:word?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'application/pdf'}),result=await window.testExtractLocalResume(file),text=typeof result==='string'?result:result.text;
     if(!text.includes(word?'Documented regression coverage':'Used SQL to validate billing data'))throw Error('Repeated parser lost evidence');word?words++:pdfs++;}
    return {documents:count,pdfs,docx:words,duration_ms:Math.round(performance.now()-started),scope:'Repeated synthetic parser fixtures; excludes upload, HTTP, ranking and AI'};
   },inputs);await page.waitForTimeout(100);assert.equal(pdfWorkers.size,0,'PDF workers leaked under volume');assert.ok(peakPdfWorkers<=2,'PDF workers grew with batch size');parsing.peak_pdf_workers=peakPdfWorkers;parsing.remaining_pdf_workers=pdfWorkers.size;
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({browser:'bulk screening',files:25,unique_saved:23,ui_ack_ms:Math.round(ack),rules_provider_calls:0,simulated_deep_calls:deepCalls,reload_and_replay:true,explicit_approval:true,job_switch_during_manifest:true,pdf_workers_released:true,server_budget:true,legacy_calls:legacyCalls,pdf_docx_zip:true,parsing,passed:true}));
 }finally{await browser?.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
