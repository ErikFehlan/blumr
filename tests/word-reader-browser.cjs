// Synthetic documents and local HTTP only; never contacts production or a model.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const policy=fs.readFileSync(path.join(root,'_headers'),'utf8');
function headersFor(url){
  let active=false;const headers={};
  for(const line of policy.split('\n')){
    if(!line.trim())continue;
    if(!line.startsWith(' ')){active=line==='/*'||line===url;continue;}
    if(active){const split=line.indexOf(':');const key=line.slice(0,split).trim(),value=line.slice(split+1).trim();headers[key]=headers[key]?headers[key]+', '+value:value;}
  }return headers;
}
(async()=>{
  let browser,networkRequests=0;
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost'),name=url.pathname;
    for(const [k,v] of Object.entries(headersFor(name)))res.setHeader(k,v);
    res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':'text/html');
    if(name==='/network-probe'){networkRequests++;res.end('unexpected');return;}
    if(name==='/'){res.end('<!doctype html><title>Word test</title><p id="frame-marker">Same origin preview</p><script src="/assets/resume-word-text.js"></script>');return;}
    if(name==='/assets/resume-word-worker.js'&&url.searchParams.has('probe')){res.end("fetch('/network-probe').then(()=>postMessage({blocked:false}),()=>postMessage({blocked:true}));");return;}
    try{res.end(fs.readFileSync(path.join(root,name)));}catch{res.statusCode=404;res.end();}
  }).listen(0,'127.0.0.1');
  const attacker=http.createServer((_q,res)=>res.end('<!doctype html><title>Other origin</title>')).listen(0,'127.0.0.1');
  try{
    browser=await chromium.launch({headless:true,executablePath:process.env.TEST_CHROME});const page=await browser.newPage();
    const origin='http://127.0.0.1:'+server.address().port;
    await page.goto(origin);
    const bytes=await require('./fixtures/docx-resume.cjs')();
    const text=await page.evaluate(async bytes=>BlumrWordText.extract(new File([Uint8Array.from(bytes)],'synthetic.docx')),[...bytes]);
    for(const expected of ['Jamie Rivera','Manual regression testing','Documented regression coverage'])assert.ok(text.includes(expected),expected);
    assert.equal(await page.evaluate(()=>typeof window.mammoth),'undefined','Parser loaded in the parent page');
    const blocked=await page.evaluate(()=>new Promise((resolve,reject)=>{const w=new Worker('/assets/resume-word-worker.js?probe=network');const timer=setTimeout(()=>{w.terminate();reject(Error('CSP probe timed out'));},5000);w.onmessage=e=>{clearTimeout(timer);w.terminate();resolve(e.data.blocked);};}));
    assert.equal(blocked,true);assert.equal(networkRequests,0,'Worker exfiltration request escaped CSP');
    await page.evaluate(()=>{const f=document.createElement('iframe');f.id='preview';f.src='/';f.sandbox='allow-scripts';document.body.append(f);});
    await page.frameLocator('#preview').locator('#frame-marker').waitFor();
    await page.goto('http://127.0.0.1:'+attacker.address().port);
    await page.evaluate(origin=>{const f=document.createElement('iframe');f.src=origin;document.body.append(f);},origin);
    await page.waitForTimeout(500);
    assert.equal(page.frames().some(f=>f.url()===origin+'/'),false,'Cross-origin embedding was accepted');
    console.log('PASS: real Word extraction, isolated parser, blocked worker network, same-origin preview and rejected cross-origin embedding.');
  }finally{await browser?.close();server.close();attacker.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
