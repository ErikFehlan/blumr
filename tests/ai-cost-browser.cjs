const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.TEST_CHROME?{executablePath:process.env.TEST_CHROME,args:['--no-sandbox']}: {})});
 try{
  const page=await browser.newPage();await page.setContent('<main id="host"></main>');await page.addScriptTag({content:fs.readFileSync('assets/admin-tools.js','utf8')});
  await page.evaluate(async()=>{
   const admin=AncalagonAdminTools.create({host:document.querySelector('#host'),load:async()=>({html:'<input id="patternFunctionUrl"><input id="patternAnonKey">'}),getSettings:()=>({}),onDenied:()=>{},
    ratesLoad:async()=>[{model:'gpt-5.6-sol',calls:2,input:4,cached:.4,cache_write:5,output:20}],ratesSave:async(...args)=>{window.savedRates=args;},
    costLoad:async()=>({provider_calls:3,unpriced_calls:1,estimated_lower_usd:.15,estimated_upper_usd:.18,rows:[],breakdown:[
     {environment:'production',purpose:'customer',operation:'resume_intake',calls:2,unpriced:0,low:.15,high:.18,mean_low:.075,mean_high:.09},
     {environment:'staging',purpose:'testing',operation:'hiring_priorities',calls:1,unpriced:1,low:null,high:null,mean_low:null,mean_high:null}]})});
   admin.setAllowed(true);await admin.open();
  });
  await page.locator('[data-admin-area="usage"]').click();
  assert.match(await page.locator('#adminCostsPanel').textContent(),/production \/ customer.*\$0\.0750–\$0\.0900 per priced response/);
  assert.match(await page.locator('#adminCostsPanel').textContent(),/staging \/ testing.*Unpriced/);
  assert.match(await page.locator('#adminCostsPanel').textContent(),/not the provider bill/);
  await page.locator('#adminRatesPanel select').selectOption('gpt-5.6-sol');
  await page.getByRole('button',{name:'Save model rate',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.savedRates),['gpt-5.6-sol',4,.4,20,5]);
  await page.setViewportSize({width:390,height:844});assert.ok(await page.locator('#adminCostsPanel').isVisible());
  console.log('PASS: cost categories, missing pricing, per-response ranges, and all four saved rates; zero paid calls.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
