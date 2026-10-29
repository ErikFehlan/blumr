const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.TEST_CHROME});const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.route('**/*',route=>route.abort());
  await page.setContent('<main id="rf-app" data-theme="tech"><section id="subscriptionBilling" class="rf-card subscription-panel" hidden></section></main>');
  for(const file of ['assets/app.css','assets/themes.css','assets/settings.css'])await page.addStyleTag({content:fs.readFileSync(file,'utf8')});
  await page.addScriptTag({content:fs.readFileSync('assets/subscription-billing.js','utf8')});
  await page.evaluate(()=>{
   window.calls=[];window.destinations=[];window.state={enabled:false};
   window.service={billing:async(action,tier)=>{window.calls.push({action,tier});if(action==='status')return window.state;if(window.hold)return new Promise(resolve=>window.release=resolve);if(window.failure)throw Error('<script>unsafe</script> Billing is unavailable');return {url:window.url||'https://checkout.stripe.com/c/pay/test'};}};
   window.ui=BlumrSubscriptionBilling.mount(document,{service:()=>window.service,navigate:url=>window.destinations.push(url),refresh:async()=>{}});
  });
  await page.evaluate(()=>ui.load());assert.equal(await page.locator('#subscriptionBilling').isVisible(),false);
  await page.evaluate(async()=>{window.state={enabled:true,eligible:true};await ui.load();});
  await page.locator('#billingTier').selectOption('pro');await page.locator('[data-billing-action="checkout"]').click();
  assert.equal(await page.evaluate(()=>calls.at(-1).tier),'pro');assert.equal(await page.evaluate(()=>destinations.length),1);assert.match(await page.locator('#subscriptionBilling').textContent(),/500 deep AI/);
  await page.evaluate(()=>{window.url='https://checkout.stripe.com.evil.test/';});await page.locator('[data-billing-action="checkout"]').click();await page.getByText('Billing returned an invalid destination.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>destinations.length),1);
  await page.evaluate(()=>{window.failure=true;});await page.locator('[data-billing-action="checkout"]').click();assert.match(await page.locator('[data-billing-status]').textContent(),/<script>unsafe/);assert.equal(await page.locator('#subscriptionBilling script').count(),0);
  await page.evaluate(async()=>{window.failure=false;window.state={enabled:true,customer:true,subscription:true,cancel_at_period_end:true};await ui.load();});assert.equal(await page.locator('[data-billing-action="checkout"]').count(),0);assert.match(await page.locator('#subscriptionBilling').textContent(),/Cancellation is scheduled/);assert.equal(await page.locator('[data-billing-action="portal"]').count(),1);
  for(const width of [390,320]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.querySelector('#subscriptionBilling').getBoundingClientRect().right<=innerWidth+1),'Mobile billing overflow');}
  if(process.env.CAPTURE_UI){fs.mkdirSync(process.env.CAPTURE_UI,{recursive:true});await page.locator('#subscriptionBilling').screenshot({path:process.env.CAPTURE_UI+'/billing-mobile.png'});}
  await page.evaluate(()=>{window.hold=true;});await page.locator('[data-billing-action="portal"]').click();assert.equal(await page.locator('[data-billing-action="portal"]').isDisabled(),true);
  await page.evaluate(()=>{ui.clear();window.release({url:'https://billing.stripe.com/p/session/test'});});await page.waitForTimeout(30);assert.equal(await page.locator('#subscriptionBilling').isVisible(),false);assert.equal(await page.evaluate(()=>destinations.length),1,'Signed-out request navigated');
  await page.evaluate(()=>{window.service={billing:()=>new Promise(resolve=>window.releaseStatus=resolve)};window.pending=ui.load();ui.clear();window.releaseStatus({enabled:true,eligible:true});return window.pending;});assert.equal(await page.locator('#subscriptionBilling').isVisible(),false);
  assert.deepEqual(errors,[]);console.log('PASS: sandbox visibility, plan selection, cancellation, safe redirects, escaped errors, mobile and signout isolation; no external traffic');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
