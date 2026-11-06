const {chromium}=require('playwright'),fs=require('fs'),http=require('http'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{const name=req.url.split('?')[0],file=path.join(root,name==='/'?'index.html':name);try{res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.webp')?'image/webp':file.endsWith('.png')?'image/png':'text/html');let content=fs.readFileSync(file);if(file.endsWith('index.html'))content=content.toString().replace(/<script[^>]+src="https:\/\/[^"]+"[^>]*><\/script>/g,'');res.end(content);}catch{res.writeHead(404);res.end();}}).listen(0,'127.0.0.1');
 await new Promise(resolve=>server.on('listening',resolve));
 let browser;const errors=[];
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.TEST_CHROME});
  const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.addInitScript(()=>{
   window.authCalls=[];window.authState=null;
   window.supabase={createClient:()=>({__homepageTest:true,auth:{
    getSession:async()=>({data:{session:null},error:null}),
    onAuthStateChange:callback=>{window.authState=callback;return {data:{subscription:{unsubscribe(){}}}};},
    signInWithPassword:async input=>{window.authCalls.push({kind:'signin',email:input.email});return {error:{message:'Invalid credentials'}};},
    signUp:async input=>{window.authCalls.push({kind:'signup',email:input.email,redirect:input.options.emailRedirectTo});return {data:{session:null},error:null};},
    resetPasswordForEmail:async(email,options)=>{window.authCalls.push({kind:'recovery',email,redirect:options.redirectTo});return {error:null};}
   }})};
  });
  const url='http://127.0.0.1:'+server.address().port+'/';
  const load=async(name='')=>{const response=await page.goto(url+name);assert.equal(response.status(),200,name);};
  await load();await page.locator('body.rf-auth-guest').waitFor();
  assert.equal(await page.evaluate(()=>window.ancalagonSupabase.__homepageTest),true);
  assert.equal(await page.locator('#rf-app').isVisible(),false);
  assert.equal(await page.locator('#authAccess').isVisible(),false,'Company homepage does not show account form');
  assert.match(await page.locator('h1:visible').textContent(),/Better opportunities/);
  assert.equal(await page.locator('.an-demo, .an-workflow').count(),0,'Products are explored on dedicated pages');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1),true,'Desktop homepage fits viewport');
  const products=page.locator('.bm-nav > details').first();
  await products.locator('summary').press('Enter');assert.equal(await products.getAttribute('open'),'');
  assert.equal(await page.getByRole('link',{name:'Resume tailoring',exact:true}).isVisible(),true);
  await page.keyboard.press('Escape');assert.equal(await products.getAttribute('open'),null);
  assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Products');
  await products.locator('summary').click();await page.getByRole('link',{name:'Resume tailoring',exact:true}).click();
  await page.waitForURL('**/candidate-tailoring.html');assert.equal(await page.locator('.bm-example').isVisible(),true);
  assert.equal(await page.getByRole('link',{name:'Build your resume →',exact:true}).getAttribute('href'),'/resume/?guest=1');
  await page.locator('.bm-logo').click();await page.waitForURL(url);
  await page.getByRole('link',{name:'Meet blumr',exact:true}).click();await page.waitForURL('**/about.html');
  assert.equal(await page.getByRole('link',{name:'About blumr',exact:true}).getAttribute('aria-current'),'page');
  await page.getByRole('link',{name:'Explore our products →',exact:true}).click();await page.waitForURL('**/products.html');
  await page.getByRole('link',{name:/blumr Recruit/}).click();await page.waitForURL('**/recruiters.html');
  await page.getByRole('link',{name:'Open recruiter workspace →',exact:true}).click();await page.locator('#authEmail').waitFor({state:'visible'});
  assert.equal(await page.locator('.bm-home').isVisible(),false,'Sign-in is a separate screen');
  await page.locator('#createAccountTab').click();
  await page.locator('#authName').fill('Demo Recruiter');await page.locator('#authEmail').fill('demo@example.com');await page.locator('#authPassword').fill('SyntheticPassword1!');await page.locator('#authConfirmPassword').fill('SyntheticPassword1!');
  await page.locator('#authSubmit').click();await page.locator('#welcomeModal').waitFor();assert.match(await page.locator('#authMessage').textContent(),/Check your email/);await page.locator('#welcomeContinue').click();
  await page.locator('#authPassword').fill('SyntheticPassword1!');await page.locator('#authSubmit').click();await page.waitForFunction(()=>document.getElementById('authMessage').textContent.includes('incorrect'));
  await page.locator('#forgotAccess').click();await page.locator('#recoverySubmit').click();await page.waitForFunction(()=>document.getElementById('recoveryMessage').textContent.includes('has been sent'));await page.locator('#recoveryCancel').click();
  const calls=await page.evaluate(()=>window.authCalls);assert.deepEqual(calls.map(c=>c.kind),['signup','signin','recovery']);assert.equal(calls[0].redirect,url);assert.equal(calls[2].redirect,url);
  await page.evaluate(()=>window.authState('PASSWORD_RECOVERY',null));await page.locator('#resetPasswordModal').waitFor();
  await load('?auth=create#authAccess');await page.locator('#authName').waitFor({state:'visible'});
  await load();await page.locator('.bm-signin > summary').click();await page.locator('[data-auth-mode="signin"]').click();assert.equal(await page.locator('#authEmail').isVisible(),true);
  await page.goBack();assert.equal(await page.locator('.bm-home').isVisible(),true);await page.goForward();assert.equal(await page.locator('#authEmail').isVisible(),true);
  const {publicPages}=await import('../scripts/public-pages.mjs');
  for(const name of publicPages.filter(name=>name!=='index.html')){
   await load(name);assert.equal(await page.locator('h1').count(),1,name);
   assert.equal(await page.locator('#rf-app, #authForm').count(),0,'Public page does not initialize workspace');
   if(/^(recruiter-|candidate-)/.test(name))assert.match(await page.locator('.bm-example-bar').textContent(),/Illustrative example/);
  }
  await load('pricing.html');assert.deepEqual(await page.locator('.an-plan-price strong').allTextContents(),['$29','$79','$150']);assert.match(await page.locator('.an-pricing-notice').textContent(),/Paid plans are not available yet/);
  await load('how-it-works.html');assert.equal(await page.locator('video[data-demo-tracking]').isVisible(),true);
  for(const width of [820,390,320]){
   await page.setViewportSize({width,height:844});
   for(const name of publicPages){await load(name==='index.html'?'':name);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,name+' overflow at '+width);}
   await load();
   if(width<700){await page.getByRole('button',{name:'Menu',exact:true}).click();}
   await products.locator('summary').click();assert.equal(await page.getByRole('link',{name:'Resume tailoring',exact:true}).isVisible(),true);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'Menu overflow at '+width);
   await page.keyboard.press('Escape');await page.locator('.bm-signin > summary').click();await page.locator('[data-auth-mode="signin"]').click();assert.equal(await page.locator('#authEmail').isVisible(),true);
  }
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
  await page.setViewportSize({width:1440,height:900});await load();await page.screenshot({path:path.join(root,'test-results/landing-desktop.png'),fullPage:true});
  await products.locator('summary').click();await page.screenshot({path:path.join(root,'test-results/landing-products.png')});
  await page.setViewportSize({width:390,height:844});await load();await page.screenshot({path:path.join(root,'test-results/landing-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);console.log('Company website passed: compact homepage, keyboard/mobile menus, public feature pages, candidate entry, preserved signup/sign-in/recovery, history navigation, and responsive layouts.');
 }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
