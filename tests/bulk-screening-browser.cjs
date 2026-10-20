// Browser extraction + actual deterministic engine. Database/provider transport
// is simulated here; real database permissions are tested in bulk-screening.sql.
const {chromium}=require('playwright'),fs=require('fs'),http=require('http'),path=require('path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const Zip=require('../assets/vendor/jszip-3.10.1.min.js'),dir=path.resolve(__dirname,'..');
(async()=>{
 const {processBulkScreeningBatch,summarizeBulkScreening}=await import('../supabase/functions/_shared/bulk-screening.ts');
 const {qualificationPools,qualificationJob}=await import('./fixtures/screening-qualification-pools.mjs');
 const pool=qualificationPools.find(p=>p.id==='qa'),source={...qualificationJob(pool,'workspace','job-a'),workspaceId:'workspace',feedback:[],assessments:[],lessons:[],sourceVersion:'source'};
 let batch=null,docs=new Map(),candidates=new Map(),failedOnce=false,deepCalls=0;
 const assessment=c=>({status:'ready',result:{name:'Candidate',score:c.result.score/10,manager_score:c.result.score/10,jd_reason:'Verified synthetic testing evidence.',manager_reason:'No additional manager preferences supplied.',resume_evidence:[{claim:'Testing work',quote:c.text.split('\n').find(t=>/Performed|Owned/.test(t))||c.text}],concerns:['Verify scope on a phone screen.'],screening_questions:['What testing did you personally own?']}});
 async function operation(op,args){
  if(op==='list')return batch?[batch]:[];
  if(op==='create'){const [id,job,manifest,budget]=args;batch={id,job_id:job,created_at:new Date().toISOString(),sealed:false,selected_ids:[],selection_version:0,budget_usd:budget,manifest};batch.items=manifest.map((f,ordinal)=>({ordinal,file_name:f.name,file_size:f.size,status:'pending'}));return id;}
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
  browser=await chromium.launch({headless:true,executablePath:process.env.TEST_CHROME});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://**',r=>r.abort());
  const pdfDir=path.dirname(require.resolve('pdfjs-dist/package.json'));
  await page.route('**/pdfjs-dist@4.10.38/**',r=>r.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(pdfDir,'build',r.request().url().includes('worker')?'pdf.worker.min.mjs':'pdf.mjs'),'utf8')}));
  await page.route('**/mammoth@1.8.0/mammoth.browser.min.js',r=>r.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(path.dirname(require.resolve('mammoth/package.json')),'mammoth.browser.min.js'),'utf8')}));
  await page.route('**/assets/auth.js*',r=>r.fulfill({contentType:'application/javascript',body:"document.body.classList.remove('rf-auth-pending');document.getElementById('authGate').style.display='none';"}));
  await page.route('**/assets/data.js*',r=>r.fulfill({contentType:'application/javascript',body:''}));
  await page.addInitScript(()=>{
   const rpc=async(op,...args)=>{const r=await fetch('/__bulk',{method:'POST',body:JSON.stringify({op,args})});const value=await r.json();if(!r.ok)throw Error(value.error);return value;};
   window.AncalagonData={create:()=>({load:async()=>({jobs:[{id:'job-a',title:'QA Engineer',description:'Perform manual testing.',criteria:[],knockouts:[],weights:[],status:'active',createdAt:1,updatedAt:1}],candidates:[],feedback:[],interviewOutcomes:[]}),schedule:(_,__,done)=>done('saved'),flush:async()=>{},trackEvent:async()=>{},loadAdminAnalytics:async()=>{throw Error('not admin');},
    screeningCapabilities:async()=>({enabled:true}),listScreeningBatches:()=>rpc('list'),createScreeningBatch:(...a)=>rpc('create',...a),prepareScreeningUpload:(...a)=>rpc('prepare',...a),updateScreeningItem:(...a)=>rpc('mark',...a),sealScreeningBatch:(...a)=>rpc('seal',...a),refreshScreeningBatch:(...a)=>rpc('refresh',...a),selectScreeningFinalists:(...a)=>rpc('select',...a),uploadResume:(c,f,t)=>rpc('upload',c,t,f.name),loadResumeText:c=>rpc('text',c),loadResumeDocument:async()=>null})};
   window.ancalagonAuth={session:{user:{id:'test'},access_token:'test-token'},workspace:{id:'workspace'}};
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.locator('#page-home.active').waitFor();await page.locator('.rf-nav [data-page="candidates"]').click();await page.locator('#screeningMode').waitFor();
  assert.equal(await page.locator('#screeningMode').inputValue(),'bulk');await page.locator('[data-bulk-budget]').fill('1.25');
  const text=i=>`Synthetic applicant ${i}\nQA Engineer\nPerformed manual testing.\nReproduced defects.\nMaintained regression tests.\nDocumented test cases.\nValidated user acceptance testing.`;
  const zip=new Zip();for(let i=0;i<20;i++)zip.file(i+'.txt',text(i));zip.file('duplicate.txt',text(0));zip.file('Word.docx',await require('./fixtures/docx-resume.cjs')());zip.file('Readable.pdf',require('./fixtures/pdf-resume.cjs')());zip.file('Broken.pdf','Not actually a PDF');zip.file('retry.txt',text(99));
  const started=performance.now();await page.locator('#resumeUpload').setInputFiles({name:'Applications.zip',mimeType:'application/zip',buffer:await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'})});
  await page.locator('[data-bulk-message]').filter({hasText:/Preparing|Import saved|Reading|Saving/}).waitFor();const ack=performance.now()-started;
  await page.waitForFunction(()=>document.querySelector('[data-bulk-message]')?.textContent.includes('Some files need attention'),{},{timeout:45000});
  assert.equal(batch.budget_usd,1.25,'Budget selection lost');assert.equal(docs.size,22,'Duplicate or readable document handling failed');assert.equal(deepCalls,0,'Upload invoked full AI');assert.equal(batch.sealed,false);assert.match(await page.locator('#bulkScreening').textContent(),/Provisional ranking/);
  assert.ok([...docs.values()].some(t=>t.includes('Documented regression coverage')),'DOCX text box lost');assert.ok([...docs.values()].some(t=>t.includes('Used SQL to validate billing data')),'PDF extraction lost');
  await page.locator('[data-bulk-resume-files]').setInputFiles({name:'retry.txt',mimeType:'text/plain',buffer:Buffer.from(text(99))});
  await page.waitForFunction(()=>document.querySelector('[data-bulk-message]')?.textContent.includes('Files saved'),{},{timeout:15000});
  const broken=batch.items.find(i=>i.file_name==='Broken.pdf');await page.locator(`[data-bulk-exclude="${broken.ordinal}"]`).click();await page.getByText('Screening complete for this batch',{exact:true}).waitFor();
  assert.equal(docs.size,23);assert.equal(deepCalls,0);assert.equal(batch.sealed,true);
  await page.locator('[data-bulk-start]').click();await page.getByRole('heading',{name:'Recommended phone screens',exact:true}).waitFor();assert.equal(deepCalls,20);
  await page.locator('[data-bulk-start]').click();await page.waitForTimeout(250);assert.equal(deepCalls,20,'Repeated shortlist created duplicate model calls');
  await page.locator('[data-bulk-resume]').first().click();await page.locator('dialog[open]').waitFor();assert.ok((await page.locator('[data-resume-text]').textContent()).length>40);await page.locator('dialog [data-close]').click();
  await page.reload();await page.locator('#page-home.active').waitFor();await page.locator('.rf-nav [data-page="candidates"]').click();await page.getByRole('heading',{name:'Recommended phone screens',exact:true}).waitFor();assert.equal(deepCalls,20);
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile overflow');
  fs.mkdirSync('test-results/bulk-screening',{recursive:true});await page.screenshot({path:'test-results/bulk-screening/mobile.png',fullPage:true});await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'test-results/bulk-screening/desktop.png',fullPage:true});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({browser:'bulk screening',files:25,unique_saved:23,ui_ack_ms:Math.round(ack),rules_provider_calls:0,simulated_deep_calls:deepCalls,reload_and_replay:true,pdf_docx_zip:true,passed:true}));
 }finally{await browser?.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
