const {chromium}=require('playwright'),fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const dir=path.resolve(__dirname,'..'),markup=fs.readFileSync(path.join(dir,'supabase/migrations/20260915150000_admin_tools.sql'),'utf8').match(/\('panel', \$resource\$([\s\S]*?)\$resource\$\)/)[1];
const plans=[{code:'basic-v1',tier:'basic',rules_limit:1000,shortlist_ai_limit:0,deep_ai_limit:0},{code:'advanced-v1',tier:'advanced',rules_limit:1000,shortlist_ai_limit:100,deep_ai_limit:0},{code:'pro-v1',tier:'pro',rules_limit:1000,shortlist_ai_limit:100,deep_ai_limit:500}];
const clone=x=>JSON.parse(JSON.stringify(x));
(async()=>{
 let saved={user:{id:'recruiter',email:'recruiter@example.test',eligible:true},account:null,version:'unassigned',plans,history:[]},revoked=false,failLookup=false,loseResponse=false,conflict=false,holdWrite=false,releaseWrite,heldResolve,apiCalls=0,external=0;const requests=new Map(),writes=[];
 const server=http.createServer(async(req,res)=>{
  if(req.url.startsWith('/rpc/')){let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw||'{}'),op=req.url.slice(5),admin=req.headers['x-test-account']==='admin'&&!revoked;
   res.setHeader('Content-Type','application/json');const send=(value,status=200)=>{res.statusCode=status;res.end(JSON.stringify(value));};
   if(op==='is-admin')return send(admin);
   if(!admin)return send({code:'42501',message:'Admin access required'},403);
   if(op==='usage')return send({totals:{accounts:2},users:[],event_breakdown:{}});
   if(op==='tools')return send({html:markup});
   if(op==='find'){apiCalls++;if(failLookup)return send({message:'Account lookup unavailable'},503);return send(body.email.trim().toLowerCase()===saved.user.email?saved:null);}
   if(op==='change'){
    apiCalls++;writes.push(clone(body));const previous=requests.get(body.p_request);
    if(previous){assert.deepEqual(previous,body);return send({replayed:true,snapshot:saved});}
    if(conflict||body.p_expected_version!==saved.version)return send({code:'PT409',message:'Changed elsewhere'},409);
    const before=clone(saved.account),plan=plans.find(p=>p.code===body.p_plan);
    if(body.p_action==='pause')saved.account.status='paused';else{
     const period=saved.account?.period||{id:'period',starts_at:new Date().toISOString()};period.ends_at=body.p_expires;
     saved.account={id:'account',tier:plan.tier,plan_code:plan.code,status:body.p_status,source:'manual',access_until:body.p_expires,period,
      usage:Object.fromEntries(['rules','shortlist_ai','deep_ai'].map(key=>{const old=saved.account?.usage[key],used=old?.used||0,pending=old?.pending||0,limit=plan[key+'_limit'];return [key,{used,pending,limit,remaining:Math.max(0,limit-used-pending)}];}))};
    }
    saved.version='revision-'+(saved.history.length+1);saved.history.unshift({id:body.p_request,action:body.p_action,actor_id:'admin',actor_email:'admin@example.test',reason:body.p_reason,before_state:before,after_state:clone(saved.account),created_at:new Date().toISOString()});requests.set(body.p_request,clone(body));
    if(holdWrite){releaseWrite=()=>send({snapshot:saved});heldResolve?.();return;}
    if(loseResponse){loseResponse=false;return send({message:'Response lost after saving'},503);}
    return send({snapshot:saved});
   }
   return send(null);
  }
  const name=req.url.split('?')[0];if(name!=='/'&&!name.startsWith('/assets/')){res.statusCode=404;return res.end();}
  const file=path.join(dir,name==='/'?'index.html':name);res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');try{res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}
 }).listen(0,'127.0.0.1');
 let browser;const errors=[];
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.TEST_CHROME});
  async function open(user){const context=await browser.newContext({viewport:{width:1440,height:1100},timezoneId:'America/New_York'}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.route('https://**',r=>{if(r.request().url().includes('/functions/'))external++;return r.abort();});
   await page.route('**/assets/auth.js*',r=>r.fulfill({contentType:'application/javascript',body:"document.body.classList.remove('rf-auth-pending');document.getElementById('authGate').style.display='none';"}));
   await page.route('**/assets/data.js*',r=>r.fulfill({contentType:'application/javascript',body:''}));
   await page.addInitScript(user=>{
    const rpc=async(op,body)=>{const response=await fetch('/rpc/'+op,{method:'POST',headers:{'X-Test-Account':user},body:JSON.stringify(body||{})});const data=await response.json();if(!response.ok)throw Object.assign(Error(data.message),{code:data.code});return data;};
    window.AncalagonData={create:()=>({load:async()=>({jobs:[],candidates:[],feedback:[],interviewOutcomes:[]}),loadHome:async()=>null,visitHome:async()=>{},loadHomeReviews:async()=>[],loadJobReassessments:async()=>[],loadSubscription:async()=>null,loadSettings:async()=>null,loadNotifications:async()=>[],loadSupportRequests:async()=>[],loadPersonalUsage:async()=>({}),trackEvent:async()=>{},schedule:()=>{},flush:async()=>{},isAppAdmin:()=>rpc('is-admin'),loadAdminAnalytics:()=>rpc('usage'),loadAdminTools:()=>rpc('tools'),loadBetaSecurity:async()=>({accounts:[],limits:{},today:{}}),loadTeamPlans:async()=>[],loadModelRates:async()=>[],loadAICostReport:async()=>null,loadSystemHealth:async()=>({}),loadDirectAIRecovery:async()=>[],loadReminderRecipients:async()=>[],adminGetSubscription:email=>rpc('find',{email}),adminChangeSubscription:change=>rpc('change',change)})};
    window.ancalagonAuth={session:{user:{id:user,user_metadata:{admin:true,role:'admin'}}},workspace:{id:user,role:'owner'}};
   },user);
   await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.locator('#page-home.active').waitFor();return {context,page};
  }
  let {page,context}=await open('regular');assert.equal(await page.locator('#adminToolsNav').isVisible(),false);assert.equal(await page.locator('#subscriptionAdminPanel').count(),0);
  const denial=await page.evaluate(async()=>{try{await window.AncalagonData.create().adminGetSubscription('recruiter@example.test');return 'allowed';}catch(e){return e.code;}});assert.equal(denial,'42501');assert.equal(apiCalls,0);await context.close();
  ({page,context}=await open('admin'));await page.locator('#adminToolsNav').waitFor();await page.locator('#adminToolsNav').click();await page.getByRole('button',{name:'Subscriptions',exact:true}).click();
  const panel=page.locator('#subscriptionAdminPanel'),search=panel.locator('[data-sub-email]');
  const find=async email=>{await search.fill(email);await panel.getByRole('button',{name:'Find account',exact:true}).click();};
  await find('missing@example.test');await panel.getByText('No unique registered account matches that email.',{exact:true}).waitFor();assert.equal(await panel.locator('.subscription-admin-edit').count(),0);
  failLookup=true;await find('recruiter@example.test');await panel.getByText('Account lookup unavailable',{exact:true}).waitFor();failLookup=false;await find('recruiter@example.test');await panel.locator('.subscription-admin-edit').waitFor();
  const edit=panel.locator('.subscription-admin-edit'),reason='Approved 30-day beta trial <script>window.injected=true</script>';
  await edit.locator('[name=plan]').selectOption('advanced-v1',{force:true});await edit.locator('[name=status]').selectOption('trialing',{force:true});await edit.locator('[name=reason]').fill(reason);const expectedEnd=await edit.locator('[name=expires]').evaluate(input=>new Date(input.value).toISOString());await edit.getByRole('button',{name:'Review change',exact:true}).click();
  assert.equal(saved.account,null,'Review step must not write');assert.match(await panel.locator('[data-sub-review]').textContent(),/recruiter@example.test.*Advanced.*Trial/s);assert.equal(await page.evaluate(()=>window.injected),undefined);
  loseResponse=true;await panel.locator('[data-sub-apply]').click();await panel.getByText(/Response lost after saving/).waitFor();assert.equal(saved.history.length,1);assert.equal(await edit.locator('[name=reason]').inputValue(),reason);
  await panel.locator('[data-sub-apply]').click();await panel.getByText('Change confirmed. No duplicate grant was created.',{exact:true}).waitFor();assert.equal(saved.history.length,1);assert.deepEqual(writes[0],writes[1]);assert.equal(writes[0].p_expires,expectedEnd);
  await panel.locator('.subscription-admin-history summary').click();assert.match(await panel.locator('.subscription-admin-history').textContent(),/admin@example.test/);assert.equal(await page.evaluate(()=>window.injected),undefined);
  saved.account.usage.rules={used:12,pending:2,limit:1000,remaining:986};await find('recruiter@example.test');await edit.waitFor();await edit.locator('[name=plan]').selectOption('pro-v1',{force:true});await edit.locator('[name=reason]').fill('Upgrade for a broader recruiting evaluation');await edit.getByRole('button',{name:'Review change',exact:true}).click();
  conflict=true;await panel.locator('[data-sub-apply]').click();await panel.getByText(/This subscription changed/).waitFor();assert.equal(await panel.locator('[data-sub-apply]').isDisabled(),true);assert.equal(saved.account.tier,'advanced');assert.match(await edit.locator('[name=reason]').inputValue(),/Upgrade/);
  conflict=false;await panel.locator('[data-sub-reload]').click();await panel.locator('[data-sub-review] section').waitFor({state:'detached'});await edit.locator('[name=plan]').selectOption('pro-v1',{force:true});await edit.locator('[name=reason]').fill('Upgrade for a broader recruiting evaluation');await edit.getByRole('button',{name:'Review change',exact:true}).click();await panel.locator('[data-sub-apply]').click();await panel.getByText('Access change saved.',{exact:true}).waitFor();assert.equal(saved.account.usage.rules.used,12);assert.equal(saved.account.usage.rules.pending,2);
  const shots=process.env.CAPTURE_UI;if(shots){fs.mkdirSync(shots,{recursive:true});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(shots,'subscription-admin-desktop.png'),fullPage:true});}
  for(const width of [390,320]){await page.setViewportSize({width,height:844});await panel.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'No mobile overflow at '+width);if(shots){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(shots,'subscription-admin-'+width+'.png'),fullPage:true});}}
  await page.setViewportSize({width:1440,height:1100});await edit.locator('[name=action]').selectOption('pause',{force:true});assert.equal(await edit.locator('[name=expires]').isDisabled(),true);await edit.locator('[name=reason]').fill('Pause this trial while feedback is reviewed');await edit.getByRole('button',{name:'Review change',exact:true}).click();await panel.locator('[data-sub-apply]').click();await panel.getByText('Access change saved.',{exact:true}).waitFor();assert.equal(saved.account.status,'paused');assert.equal(saved.account.usage.rules.used,12);
  saved.account.source='stripe';await find('recruiter@example.test');await panel.getByText(/managed by billing/).waitFor();assert.equal(await edit.count(),0);saved.account.source='manual';
  revoked=true;await find('recruiter@example.test');await page.locator('#adminToolsContent').waitFor({state:'hidden'});assert.equal(await page.locator('#adminToolsContent').textContent(),'');await context.close();
  revoked=false;({page,context}=await open('admin'));await page.locator('#adminToolsNav').waitFor();await page.locator('#adminToolsNav').click();await page.getByRole('button',{name:'Subscriptions',exact:true}).click();const fresh=page.locator('#subscriptionAdminPanel');await fresh.locator('[data-sub-email]').fill('recruiter@example.test');await fresh.getByRole('button',{name:'Find account',exact:true}).click();const freshEdit=fresh.locator('.subscription-admin-edit');await freshEdit.waitFor();await freshEdit.locator('[name=reason]').fill('Resume after the recruiting trial review');await freshEdit.getByRole('button',{name:'Review change',exact:true}).click();
  holdWrite=true;const held=new Promise(resolve=>heldResolve=resolve);await fresh.locator('[data-sub-apply]').click();await held;await page.evaluate(()=>window.dispatchEvent(new CustomEvent('ancalagon:auth-cleared')));releaseWrite();await page.waitForLoadState('networkidle');assert.equal(await page.locator('#adminToolsContent').textContent(),'');assert.equal(await page.locator('#adminToolsNav').isVisible(),false);
  assert.equal(external,0);assert.deepEqual(errors,[]);await context.close();console.log('Subscription admin browser passed: hidden non-admin access, exact lookup, review, lost-response retry, conflicts, preserved usage, pause, billing guard, audit escaping, mobile, revocation and late signout response.');
 }finally{await browser?.close();server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exit(1);});
