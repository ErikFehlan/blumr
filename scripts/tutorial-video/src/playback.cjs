const {chromium}=require('playwright');
const fs=require('fs'),http=require('http'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'../../..'),out=path.resolve(__dirname,'../output');
(async()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(out,'manifest.json'),'utf8'));
 // Exercise the actual marketing-page player against the unpublished export.
 // Only the video URL and duration copy are substituted for this QA run.
 const pageHTML=fs.readFileSync(path.join(root,'how-it-works.html'),'utf8')
  .replace(/assets\/blumr-tutorial-\d{8}\.mp4/g,'demo.mp4');
 const server=http.createServer((req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname;
  try{
   const file=name==='/demo.mp4'?path.join(out,'Blumr_Tutorial_20261009.mp4'):path.join(root,name.slice(1));
   const data=name==='/how-it-works.html'?Buffer.from(pageHTML):fs.readFileSync(file);
   const mime={'.html':'text/html','.css':'text/css','.js':'application/javascript','.mp4':'video/mp4','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml'};
   res.setHeader('Content-Type',mime[path.extname(name)]||'application/octet-stream');res.setHeader('Accept-Ranges','bytes');
   const match=/bytes=(\d+)-(\d*)/.exec(req.headers.range||'');
   if(match){const start=Number(match[1]),end=Math.min(match[2]?Number(match[2]):data.length-1,data.length-1);res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${data.length}`,'Content-Length':end-start+1});res.end(data.subarray(start,end+1));}
   else res.end(data);
  }catch{res.writeHead(404);res.end();}
 }).listen(0,'127.0.0.1');
 const browser=await chromium.launch({headless:true,executablePath:process.env.TEST_CHROME||chromium.executablePath(),args:['--no-sandbox']});
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://**',r=>r.abort());
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:900});
   await page.goto('http://127.0.0.1:'+server.address().port+'/how-it-works.html');
   await page.waitForFunction(()=>document.querySelector('video').readyState>=1);
   assert(Math.abs(await page.locator('video').evaluate(v=>v.duration)-manifest.duration)<.1);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Player layout overflows viewport');
   const seek=Math.min(42,manifest.duration-2);
   await page.locator('video').evaluate(async(v,t)=>{v.muted=true;v.currentTime=t;await v.play();},seek);
   await page.waitForFunction(t=>{const v=document.querySelector('video');return v.currentTime>t+.2&&!v.seeking&&!v.paused&&!v.error;},seek);
   await page.locator('video').evaluate(v=>v.pause());
   await page.screenshot({path:path.join(out,'playback-'+width+'.png')});
  }
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'playback-check.json'),JSON.stringify({status:'passed',widths:[1440,390],duration:manifest.duration,source_sha:manifest.source_sha},null,2));
  console.log('PASS: export metadata, seeking, playback and responsive player layout');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
