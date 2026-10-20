// The real browser app and data service talk to authenticated staging through a
// loopback-only transport. The bridge keeps disposable credentials out of pages
// and records every original file for the existing ownership-checked cleanup.
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
const {mixedFiles}=require('../tests/fixtures/mixed-screening-resumes.cjs');
const root=path.resolve(__dirname,'..');
const normalized=s=>s.toLowerCase().replace(/\s+/g,' ').trim();
async function openBrowser({f,user,report={}}={}){
 const saved=new Map(),requests=[],errors=[],workers=new Set();let peakWorkers=0,batch,interrupted=false,interruptPath;
 const bridgeErrors=[];
 const server=http.createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://localhost');
   if(/^\/(rest|functions|storage)\/v1\//.test(url.pathname)){
    if(!f)throw Error('Hosted bridge unavailable');
    let chunks=[];for await(const chunk of req)chunks.push(chunk);const raw=Buffer.concat(chunks);
    res.setHeader('Content-Type','application/json');
    if(url.pathname.startsWith('/storage/v1/object/resumes/')&&req.method==='POST'){
     const key=decodeURIComponent(url.pathname.slice('/storage/v1/object/resumes/'.length));
     // The first file commits to Storage but loses its HTTP response. Retrying
     // must reuse the object and finish the document, without duplicating it.
     const response=await f.upload(user,key,raw,req.headers['content-type'],false,true),status=response.status;
     if(status<300&&!interrupted){interrupted=true;interruptPath=key;req.socket.destroy();return;}
     res.statusCode=status;res.end(JSON.stringify(response.data));return;
    }
    const body=raw.length?JSON.parse(raw):undefined;
    const result=await f.request(url.pathname+url.search,user.access,req.method,body,false);
    requests.push({path:url.pathname,method:req.method,status:result.status});
    if(url.pathname==='/rest/v1/rpc/create_screening_batch'&&result.ok)batch=body.p_id;
    if(url.pathname==='/rest/v1/candidate_documents'&&req.method==='POST'&&result.ok){for(const doc of Array.isArray(body)?body:[body])saved.set(doc.candidate_id,doc);if(saved.size%100===0)console.log('Mixed browser saved '+saved.size);}
    res.statusCode=result.status;res.end(result.status===204?'':JSON.stringify(result.data));return;
   }
   if(url.pathname.startsWith('/__vendor/')){
    const name=url.pathname.slice('/__vendor/'.length),pkg=n=>path.dirname(require.resolve(n+'/package.json'));
    let file;if(name==='pdf.mjs'||name==='pdf.worker.min.mjs')file=path.join(pkg('pdfjs-dist'),'build',name);
    else if(name==='mammoth.js')file=path.join(pkg('mammoth'),'mammoth.browser.min.js');
    else if(name==='tesseract.min.js'||name==='worker.min.js')file=path.join(pkg('tesseract.js'),'dist',name);
    else if(/^core\/tesseract-core[-a-z]*\.wasm(?:\.js)?$/.test(name))file=path.join(pkg('tesseract.js-core'),path.basename(name));
    else if(name==='tessdata/eng.traineddata.gz')file=path.join(require('@tesseract.js-data/eng').langPath,'eng.traineddata.gz');
    else throw Error('Unexpected browser dependency');
    res.setHeader('Content-Type',file.endsWith('.wasm')?'application/wasm':file.endsWith('.gz')?'application/octet-stream':'application/javascript');
    let content=fs.readFileSync(file);
    if(name==='tesseract.min.js')content=content.toString()+`\n;{const create=Tesseract.createWorker;window.Tesseract={...Tesseract,createWorker:(language,oem,options={})=>create(language,oem,{...options,workerPath:new URL('/__vendor/worker.min.js',location.href).href,corePath:new URL('/__vendor/core',location.href).href,langPath:new URL('/__vendor/tessdata',location.href).href})};}`;
    res.end(content);return;
   }
   if(url.pathname==='/__fixture-supabase.js'){res.setHeader('Content-Type','application/javascript');res.end(fs.readFileSync(path.join(path.dirname(require.resolve('@supabase/supabase-js/package.json')),'dist/umd/supabase.js')));return;}
   const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
   if(!file.startsWith(root+path.sep)){res.statusCode=404;res.end();return;}
   res.setHeader('Content-Type',/\.(js|mjs)$/.test(file)?'application/javascript':file.endsWith('.css')?'text/css':'text/html');let contents=fs.readFileSync(file);if(file.endsWith('/index.html'))contents=contents.toString().replace(/<script src="https:\/\/cdn.jsdelivr.net\/npm\/@supabase\/supabase-js@2.116.0"[^>]*><\/script>/,'<script src="/__fixture-supabase.js"></script>');if(file.endsWith('/assets/app.js'))contents=contents.toString().replaceAll('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs/+esm','/__vendor/pdf.mjs').replaceAll('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs','/__vendor/pdf.worker.min.mjs').replaceAll('https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js','/__vendor/mammoth.js').replaceAll('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js','/__vendor/tesseract.min.js');res.end(contents);
  }catch(error){bridgeErrors.push(error.message);if(process.env.BULK_DEBUG)console.error('Fixture request failed '+req.url+': '+error.message);res.statusCode=500;res.end(JSON.stringify({message:'Fixture bridge failed'}));}
 }).listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 let browser;try{browser=await chromium.launch({headless:true,executablePath:process.env.TEST_CHROME,args:process.env.TEST_CHROME?['--no-sandbox','--disable-dev-shm-usage','--no-zygote','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']:[]});}catch(e){server.close();throw e;}
 const context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(30000);
 page.on('pageerror',e=>errors.push(e.message));if(process.env.BULK_DEBUG)page.on('console',m=>console.log('Browser '+m.type()+': '+m.text().slice(0,500)));page.on('worker',w=>{workers.add(w);peakWorkers=Math.max(peakWorkers,workers.size);w.on('close',()=>workers.delete(w));});
 await page.route('https://**',route=>route.abort());
 const origin='http://127.0.0.1:'+server.address().port;
 await page.route('**/assets/auth.js*',route=>route.fulfill({contentType:'application/javascript',body:`document.body.classList.remove('rf-auth-pending');document.getElementById('authGate').style.display='none';window.ancalagonAuth={session:{user:{id:${JSON.stringify(user?.id||'test')}},access_token:'fixture'},workspace:{id:${JSON.stringify(user?.workspace||'workspace')}},client:window.supabase.createClient(${JSON.stringify(origin)},'fixture-anon',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})};`}));
 if(!f)await page.route('**/assets/data.js*',r=>r.fulfill({contentType:'application/javascript',body:`window.AncalagonData={create:()=>({load:async()=>({jobs:[],candidates:[],feedback:[],interviewOutcomes:[]}),schedule:(_,__,done)=>done('saved'),flush:async()=>{},trackEvent:async()=>{},loadAdminAnalytics:async()=>{throw Error('not admin')},screeningCapabilities:async()=>({enabled:false})})};`}));
 await page.route('**/assets/resume-intake.js*',r=>r.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(root,'assets/resume-intake.js'),'utf8')+';{const original=window.AncalagonIntake.create;window.AncalagonIntake.create=api=>{window.testExtractLocalResume=api.extract;return original(api);};}'}));
 try{await page.goto(origin,{waitUntil:'domcontentloaded',timeout:120000});await page.waitForFunction(()=>typeof window.testExtractLocalResume==='function',{},{timeout:90000});}catch(e){console.error('Browser startup errors: '+JSON.stringify(errors));await browser.close();server.close();throw e;}
 return {page,saved,requests,errors,bridgeErrors,get batch(){return batch;},get interrupted(){return interrupted;},get interruptPath(){return interruptPath;},get workers(){return {peak:peakWorkers,remaining:workers.size};},async close(){await browser.close();await new Promise(resolve=>server.close(resolve));}};
}
async function parserPreflight(count=50){
 const b=await openBrowser();
 try{
  console.log('Mixed parser initialized');const fixture=await mixedFiles(b.page,count),results=[];const started=performance.now();
  for(const row of [...fixture.rows,...fixture.extra]){console.log('Parsing '+row.name+' ('+(row.layout||'unreadable')+')');
   const value=await b.page.evaluate(async({name,bytes})=>{try{const file=new File([Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))],name);const result=await window.testExtractLocalResume(file);return {text:typeof result==='string'?result:result.text};}catch(e){return {error:e?.message||String(e)};}},{name:row.name,bytes:row.bytes.toString('base64')});
   if(row.bad){assert.ok(value.error||!value.text?.trim(),'Unreadable file unexpectedly produced evidence');}
   else{
    assert.ok(value.text,'Readable fixture did not parse: '+row.name+' '+value.error);
    for(const line of row.text.split('\n').filter(s=>/Performed |Reproduced |Maintained |Documented |Validated |No |Skills|Professional experience/.test(s)))assert.ok(normalized(value.text).includes(normalized(line)),'Evidence missing in '+row.name+': '+line);
   }
   results.push({name:row.name,layout:row.layout||'damaged',readable:!!value.text?.trim(),error:value.error||null});
  }
  await b.page.waitForTimeout(200);assert.equal(b.workers.remaining,0);assert.deepEqual(b.errors,[]);
  const report={scope:'Actual application parsers and OCR, generated mixed-layout documents; no hosted transport or AI',documents:results.length,formats:fixture.formats,layouts:fixture.layouts,duration_ms:Math.round(performance.now()-started),workers:b.workers,results,passed:true};
  fs.mkdirSync('test-results/bulk-screening',{recursive:true});fs.writeFileSync('test-results/bulk-screening/mixed-parser.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));return report;
 }finally{await b.close();}
}
module.exports={openBrowser,parserPreflight,mixedFiles,normalized};
if(require.main===module)parserPreflight(Number(process.env.BULK_MIXED_COUNT||50)).catch(e=>{console.error(e);process.exitCode=1;});

async function importMixed({f,user,report,count=500}){
 const b=await openBrowser({f,user,report});
 try{
  const fixture=await mixedFiles(b.page,count),page=b.page;
  await page.locator('#page-home.active').waitFor();await page.locator('.rf-nav [data-page="candidates"]').click();await page.locator('#screeningMode').waitFor();
  assert.equal(await page.locator('#screeningMode').inputValue(),'bulk');
  const upload={name:'Mixed-Applications.zip',mimeType:'application/zip',buffer:fixture.zip};
  const started=performance.now();await page.locator('#resumeUpload').setInputFiles(upload);
  await page.locator('[data-bulk-message]').filter({hasText:/Preparing|Import saved|Reading|Saving/}).waitFor();report.browser_ack_ms=Math.round(performance.now()-started);
  await page.waitForFunction(()=>document.querySelector('[data-bulk-message]')?.textContent.includes('Some files need attention'),{},{timeout:900000});
  assert.ok(b.interrupted,'Lost upload response was not exercised');
  assert.equal(b.saved.size,count-1,'Unexpected saved count before retry');
  const loadSnapshot=async()=>{const r=await f.request('/rest/v1/rpc/screening_batch_snapshot',user.access,'POST',{p_batch:b.batch});return r.data;};
  const unfinished=await loadSnapshot();assert.equal(unfinished.batch.sealed,false);assert.equal(unfinished.items.length,count+5);
  assert.equal(unfinished.items.filter(i=>i.status==='failed').length,4);
  // Reload proves that recovery is driven by the durable server manifest.
  await page.reload();await page.locator('#page-home.active').waitFor();await page.locator('.rf-nav [data-page="candidates"]').click();await page.locator('[data-bulk-resume-files]').waitFor();
  await page.locator('[data-bulk-resume-files]').setInputFiles(upload);
  await page.waitForFunction(()=>document.querySelector('[data-bulk-message]')?.textContent.includes('Some files need attention'),{},{timeout:180000});
  assert.equal(b.saved.size,count,'Retry lost or duplicated a document');
  const retry=await loadSnapshot(),remaining=retry.items.filter(i=>i.status==='failed');assert.equal(remaining.length,3);
  for(const item of remaining){assert.ok(/Damaged\.|Blank-scan/.test(item.file_name),'Readable resume failed: '+item.file_name);await page.locator(`[data-bulk-exclude="${item.ordinal}"]`).click();await page.waitForFunction(ordinal=>!document.querySelector(`[data-bulk-exclude="${ordinal}"]`),item.ordinal);}
  await page.getByText('Screening complete for this batch',{exact:true}).waitFor({timeout:180000});
  report.upload_ms=Math.round(performance.now()-started);report.mixed={formats:fixture.formats,layouts:fixture.layouts,manifest_entries:count+5,unique_saved:count,duplicates:2,explicitly_excluded:3,lost_storage_response_recovered:true,reload_recovery:true,workers:b.workers,transport:'Actual assets/data.js and Supabase SDK through a staging-only authenticated loopback proxy; real original files and database records'};
  const rows=fixture.rows.map((row,i)=>{
   const doc=[...b.saved.values()].find(d=>d.file_name===row.name);assert.ok(doc,'Stored original missing: '+row.name);
   assert.equal(doc.file_size,row.bytes.length);assert.ok(doc.storage_path.endsWith('.'+row.kind));
   for(const line of row.text.split('\n').filter(s=>/Performed |Reproduced |Maintained |Documented |Validated |No |Skills|Professional experience/.test(s)))assert.ok(normalized(doc.extracted_text).includes(normalized(line)),'Stored source evidence lost in '+row.name+': '+line);
   return {name:row.name,text:doc.extracted_text};
  });
  assert.equal(b.workers.remaining,0);assert.deepEqual(b.errors,[]);assert.deepEqual(b.bridgeErrors,[]);
  assert.equal(b.requests.filter(r=>r.path==='/rest/v1/rpc/request_resume_intake').length,0,'Bulk import entered legacy AI');
  return {batch:b.batch,rows,manifestCount:count+5};
 }finally{await b.close();}
}
module.exports.importMixed=importMixed;
