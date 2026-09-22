const {chromium}=require('playwright'),fs=require('fs'),http=require('http'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{const name=req.url.split('?')[0],file=path.join(root,name==='/'?'index.html':name);try{res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html');let content=fs.readFileSync(file);if(file.endsWith('index.html'))content=content.toString().replace(/<script[^>]+src="https:\/\/[^"]+"[^>]*><\/script>/g,'');res.end(content);}catch{res.writeHead(404);res.end();}}).listen(0,'127.0.0.1');
 let browser,page;const errors=[];
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.TEST_CHROME});
  page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
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
  const url='http://127.0.0.1:'+server.address().port+'/';await page.goto(url);await page.locator('body.rf-auth-guest').waitFor();
  assert.equal(await page.evaluate(()=>window.ancalagonSupabase?.__homepageTest),true,'Only the in-memory auth fixture may handle this test');
  assert.equal(await page.locator('#rf-app').isVisible(),false);assert.equal(await page.locator('#an-title').isVisible(),true);
  assert.deepEqual(await page.locator('.an-nav-links a').allTextContents(),['The experience','How it works','Why blumr Works','About']);
  await page.getByRole('link',{name:'Why blumr Works',exact:true}).click();await page.waitForURL('**/why-blumr-works.html');
  assert.equal(await page.title(),'Why blumr Works | Recruiting intelligence');
  assert.equal(await page.getByRole('heading',{level:1,name:'Why blumr Works',exact:true}).isVisible(),true);
  assert.equal(await page.locator('#about, #rf-app, #authForm').count(),0,'Why blumr Works has its own public page');
  assert.equal(await page.evaluate(()=>window.ancalagonSupabase),undefined,'Why blumr Works does not initialize authentication');
  assert.equal(await page.getByRole('link',{name:'Why blumr Works',exact:true}).getAttribute('aria-current'),'page');
  await page.reload();assert.ok((await page.locator('#an-why-title').boundingBox()).y<400,'Why page opens at the top on direct loads');
  await page.locator('.an-why .an-button-primary').click();await page.waitForURL('**/?auth=create#authAccess');await page.locator('body.rf-auth-guest').waitFor();
  assert.equal(await page.locator('#authNameField').isVisible(),true,'Why page Get started selects account creation');
  await page.waitForFunction(()=>document.activeElement.id==='authName');
  await page.getByRole('link',{name:'Why blumr Works',exact:true}).click();await page.waitForURL('**/why-blumr-works.html');
  await page.getByRole('link',{name:'About',exact:true}).click();await page.waitForURL('**/about.html');
  assert.equal(await page.title(),'About blumr | Built by recruiters, for recruiters.');
  assert.equal(await page.locator('#an-about-title').isVisible(),true);
  assert.equal(await page.locator('#why-blumr-works').count(),0,'Why content is separate from About');
  assert.equal(await page.locator('#rf-app, #authForm').count(),0,'About is a separate public document');
  assert.equal(await page.evaluate(()=>window.ancalagonSupabase),undefined,'About does not initialize authentication');
  assert.equal(await page.getByRole('link',{name:'About',exact:true}).getAttribute('aria-current'),'page');
  await page.reload();assert.ok((await page.getByRole('heading',{level:1}).boundingBox()).y<400,'About opens at the top on direct loads');
  await page.locator('.an-header .an-nav-start').click();await page.waitForURL('**/?auth=create#authAccess');await page.locator('body.rf-auth-guest').waitFor();
  assert.equal(await page.locator('#authNameField').isVisible(),true,'Get started selects account creation');
  await page.waitForFunction(()=>document.activeElement.id==='authName');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'authName');
  await page.getByRole('link',{name:'About',exact:true}).click();await page.waitForURL('**/about.html');
  await page.locator('.an-header .an-nav-login').click();await page.waitForURL('**/#authAccess');await page.locator('body.rf-auth-guest').waitFor();
  assert.equal(await page.locator('#signInTab').getAttribute('aria-selected'),'true','About Log in opens sign-in');
  await page.goto(url);await page.locator('body.rf-auth-guest').waitFor();
  assert.equal(await page.locator('#about').count(),0,'About content is no longer below the homepage');
  assert.match(await page.locator('.an-demo-toolbar').textContent(),/sample data/);
  assert.equal(await page.locator('[role="tabpanel"]:visible').count(),1);
  await page.locator('[data-explore-preview]').click();assert.equal(await page.evaluate(()=>document.activeElement.id),'an-tab-brief');
  await page.locator('#an-tab-context').click();assert.equal(await page.locator('#an-panel-context').isVisible(),true);
  await page.locator('#an-tab-context').press('ArrowRight');assert.equal(await page.locator('#an-tab-brief').getAttribute('aria-selected'),'true');
  await page.locator('#an-tab-brief').press('End');assert.equal(await page.locator('#an-panel-feedback').isVisible(),true);
  await page.locator('#an-tab-brief').click();await page.locator('#an-panel-brief summary').click();assert.equal(await page.locator('#an-panel-brief blockquote').isVisible(),true);await page.locator('#an-panel-brief summary').click();
  await page.locator('.an-faq-list summary').first().focus();await page.keyboard.press('Enter');assert.equal(await page.locator('.an-faq-list details').first().getAttribute('open'),'');await page.keyboard.press('Enter');
  await page.locator('.an-hero [data-auth-mode="create"]').click();assert.equal(await page.locator('#authNameField').isVisible(),true);assert.equal(await page.evaluate(()=>document.activeElement.id),'authName');
  await page.locator('#authName').fill('Demo Recruiter');await page.locator('#authEmail').fill('demo@example.com');await page.locator('#authPassword').fill('SyntheticPassword1!');await page.locator('#authConfirmPassword').fill('SyntheticPassword1!');
  await page.locator('#authSubmit').click();await page.locator('#welcomeModal').waitFor();assert.deepEqual(errors,[]);assert.equal(await page.locator('#createAccountTab').getAttribute('aria-selected'),'false',JSON.stringify(await page.evaluate(()=>({calls:window.authCalls,message:document.getElementById('welcomeMessage').textContent,status:document.getElementById('authMessage').textContent}))));await page.locator('#welcomeContinue').click();
  await page.locator('.an-header [data-auth-mode="signin"]').click();assert.equal(await page.evaluate(()=>document.activeElement.id),'authEmail');assert.equal(await page.locator('#authNameField').isVisible(),false);
  await page.locator('#authEmail').fill('demo@example.com');await page.locator('#authPassword').fill('SyntheticPassword1!');await page.locator('#authSubmit').click();await page.waitForFunction(()=>document.getElementById('authMessage').textContent.includes('incorrect'));
  await page.locator('#forgotAccess').click();await page.locator('#recoverySubmit').click();await page.waitForFunction(()=>document.getElementById('recoveryMessage').textContent.includes('has been sent'));await page.locator('#recoveryCancel').click();
  const calls=await page.evaluate(()=>window.authCalls);assert.deepEqual(calls.map(c=>c.kind),['signup','signin','recovery']);assert.equal(calls[0].redirect,url);assert.equal(calls[2].redirect,url);
  await page.evaluate(()=>window.authState('PASSWORD_RECOVERY',null));await page.locator('#resetPasswordModal').waitFor();
  await page.reload();await page.locator('body.rf-auth-guest').waitFor();await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>scrollTo(0,0));fs.mkdirSync(path.join(root,'test-results'),{recursive:true});await page.screenshot({path:path.join(root,'test-results/landing-desktop.png'),fullPage:true});
  await page.screenshot({path:path.join(root,'test-results/landing-hero.png')});
  await page.locator('.an-header [data-auth-mode="signin"]').click();await page.screenshot({path:path.join(root,'test-results/landing-login.png')});
  for(const tab of ['context','feedback']){await page.locator('#an-tab-'+tab).click();await page.locator('.an-showcase').screenshot({path:path.join(root,'test-results/landing-preview-'+tab+'.png')});}await page.locator('#an-tab-brief').click();
  for(const width of [820,390,320]){
   await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'homepage overflow at '+width);
   await page.getByRole('link',{name:'About',exact:true}).click();await page.waitForURL('**/about.html');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'About overflow at '+width);
   assert.ok((await page.getByRole('heading',{level:1}).boundingBox()).y<400,'About page heading is at the top at '+width);
   await page.getByRole('link',{name:'Why blumr Works',exact:true}).click();await page.waitForURL('**/why-blumr-works.html');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'Why page overflow at '+width);
   assert.ok((await page.locator('#an-why-title').boundingBox()).y<400,'Why page heading is at the top at '+width);
   await page.getByRole('link',{name:'Back to home',exact:true}).click();await page.waitForURL(url);await page.locator('body.rf-auth-guest').waitFor();
   await page.locator('.an-final [data-auth-mode="create"]').click();assert.equal(await page.locator('#authNameField').isVisible(),true);assert.equal(await page.evaluate(()=>document.activeElement.id),'authName');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'signup overflow at '+width);
   await page.locator('.an-header [data-auth-mode="signin"]').click();
  }
  await page.setViewportSize({width:390,height:844});await page.locator('.an-header .an-brand').click();await page.screenshot({path:path.join(root,'test-results/landing-small-screen.png'),fullPage:true});
  await page.screenshot({path:path.join(root,'test-results/landing-small-hero.png')});
  assert.deepEqual(errors,[]);console.log('Public homepage passed: separate Why blumr Works and About pages, navigation order, direct loading, public account links, product preview, keyboard tabs, sign-in and signup entry points, unchanged recovery URLs and callback, private app hidden, and desktop/small-screen layout.');
 }catch(error){
  if(page)console.error('Synthetic homepage state:',JSON.stringify(await page.evaluate(()=>({calls:window.authCalls,mode:document.getElementById('createAccountTab')?.getAttribute('aria-selected'),message:document.getElementById('authMessage')?.textContent,welcomeHidden:document.getElementById('welcomeModal')?.hidden,invalid:[...document.querySelectorAll('#authForm input')].map(e=>({id:e.id,valid:e.checkValidity(),length:e.value.length})),active:document.activeElement?.id}))),errors);
  throw error;
 }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
