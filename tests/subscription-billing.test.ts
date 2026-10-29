import {handleBilling,handleStripeWebhook,handleBillingReconcile,reconcile,reconcileRisk,verifySignature,STRIPE_VERSION,type IO} from '../supabase/functions/_shared/stripe-billing.ts';
import captured from './fixtures/subscription-stripe-sandbox.json' with {type:'json'};
function assert(value:unknown,message='Assertion failed'):asserts value{if(!value)throw Error(message);}
const now=Date.parse('2026-10-28T12:00:00Z'),user='00000000-0000-0000-0000-000000000001';
const price={id:'price_basic',livemode:false,active:true,currency:'usd',unit_amount:2900,type:'recurring',billing_scheme:'per_unit',recurring:{interval:'month',interval_count:1,usage_type:'licensed'}};
const subscription=()=>({id:'sub_first',customer:'cus_first',livemode:false,status:'active',collection_method:'charge_automatically',cancel_at_period_end:false,metadata:{blumr_checkout:'operation'},latest_invoice:'in_first',items:{has_more:false,data:[{id:'si_first',quantity:1,current_period_start:now/1000-60,current_period_end:now/1000+2591940,price:structuredClone(price)}]}});
const invoice=()=>({id:'in_first',livemode:false,customer:'cus_first',status:'paid',currency:'usd',parent:{subscription_details:{subscription:'sub_first'}},lines:{has_more:false,data:[{livemode:false,parent:{subscription_item_details:{subscription_item:'si_first',proration:false}},pricing:{price_details:{price:'price_basic'}},quantity:1,period:{start:now/1000-60,end:now/1000+2591940}}]}});
function fixture(){
 const env:Record<string,string>={STRIPE_BILLING_SANDBOX_ENABLED:'true',SUBSCRIPTION_FOUNDATION_ENABLED:'true',STRIPE_SECRET_KEY:'sk_test_synthetic',SUPABASE_URL:'https://supabase.example.test',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',SUPABASE_ANON_KEY:'synthetic-anon',BILLING_APP_URL:'https://blumr.pages.dev/',STRIPE_PRICE_BASIC:'price_basic',STRIPE_PRICE_ADVANCED:'price_advanced',STRIPE_PRICE_PRO:'price_pro',STRIPE_PORTAL_CONFIGURATION_ID:'bpc_test',STRIPE_WEBHOOK_SECRET:'whsec_synthetic',BILLING_RECONCILE_SECRET:'synthetic-private-worker-secret-12345678'};
 const state:any={row:{user_id:user,lease_id:'lease',provision_id:'provision',provision_started_at:new Date(now).toISOString(),customer_id:null,checkout_id:null,subscription_id:null},subs:[],invoice:invoice(),price:structuredClone(price),auth:true,verified:true,rpc:[],requests:[],claimed:false,sessionStatus:'open',portalUpdates:false,failRPC:null,customerCreates:[],checkoutCreates:[]};
 const io:IO={env:n=>env[n],now:()=>now,fetch:async(input,init)=>{
  const url=String(input);state.requests.push({url,init});
  if(url.endsWith('/auth/v1/user'))return Response.json({id:user,email_confirmed_at:state.verified?'2026-01-01':null},{status:state.auth?200:401});
  if(url.includes('/rest/v1/rpc/')){
   const {p_action:action,p_args:args}=JSON.parse(String(init?.body));
   if(url.includes('billing_risk_command')){state.riskCalls||=[];state.riskCalls.push({action,args});return Response.json(action==='session'?{valid:state.sessionValid!==false}:action==='claim_next'?null:{queued:true});}
   state.rpc.push({action,args});
   if(state.failRPC===action)return Response.json({code:'XX000'},{status:503});
   let result:any={};
   if(action==='status')result={eligible:true,customer:!!state.row.customer_id,subscription:!!state.row.subscription_id,pending:!!state.row.checkout_id};
   if(action==='claim')result=state.row;
   if(action==='claim_next'){result=state.claimed?null:state.row;state.claimed=true;}
   if(action==='customer'){state.row.customer_id=args.customer;result=state.row;}
   if(action==='checkout_start'){if(!state.row.checkout_id)Object.assign(state.row,{checkout_id:'operation',checkout_tier:args.tier,checkout_started_at:new Date(now).toISOString(),checkout_expires_at:new Date(now+3600000).toISOString()});result=state.row;}
   if(action==='checkout_save'){Object.assign(state.row,{checkout_session:args.session,checkout_url:args.url});result=state.row;}
   if(action==='checkout_close'){state.row.checkout_id=null;state.row.checkout_session=null;result=state.row;}
   return Response.json(result);
  }
  assert(url.startsWith('https://api.stripe.com/v1/'),'Unexpected external transport');
  const h=new Headers(init?.headers);assert(h.get('stripe-version')===STRIPE_VERSION,'Version not pinned');assert(h.get('authorization')==='Bearer '+env.STRIPE_SECRET_KEY);
  const path=url.split('/v1/')[1],form=new URLSearchParams(String(init?.body||''));
  if(path==='customers'){state.customerCreates.push(h.get('idempotency-key'));return Response.json({id:'cus_first',livemode:false});}
  if(path==='customers/cus_first')return Response.json({id:'cus_first',livemode:state.liveCustomer||false});
  if(path.startsWith('subscriptions?'))return Response.json({data:state.subs,has_more:state.moreSubs||false});
  if(path.startsWith('prices/'))return Response.json(state.price);
  if(path==='checkout/sessions'){
   state.checkoutCreates.push({key:h.get('idempotency-key'),form:Object.fromEntries(form)});
   assert(/^blumr_sandbox_[a-z]{8}$/.test(form.get('integration_identifier')||''));assert(!form.has('user_id')&&!form.has('customer_email')&&!form.has('payment_method_types[0]'));assert(form.get('allowed_payment_method_types[0]')==='card'&&form.get('subscription_data[billing_mode][type]')==='flexible');return Response.json({id:'cs_test_first',livemode:false,customer:'cus_first',mode:'subscription',status:state.sessionStatus,url:'https://checkout.stripe.com/c/pay/cs_test_first'});
  }
  if(path==='checkout/sessions/cs_test_first')return Response.json({id:'cs_test_first',livemode:false,customer:'cus_first',status:state.sessionStatus,url:'https://checkout.stripe.com/c/pay/cs_test_first',subscription:'sub_first'});
  if(path==='billing_portal/configurations/bpc_test')return Response.json({id:'bpc_test',livemode:false,active:true,features:{subscription_update:{enabled:state.portalUpdates},subscription_cancel:{enabled:true,mode:'at_period_end'},payment_method_update:{enabled:true},invoice_history:{enabled:true}}});
  if(path==='billing_portal/sessions')return Response.json({customer:form.get('customer'),url:state.portalURL||'https://billing.stripe.com/p/session/test'});
  if(path==='invoices/in_first')return Response.json(state.invoice);
  throw Error('Unexpected Stripe path: '+path);
 }};
 return {env,state,io};
}
const request=(body:unknown,token='header.'+btoa(JSON.stringify({session_id:'00000000-0000-0000-0000-000000000009'}))+'.signature')=>new Request('https://edge.test/billing',{method:'POST',headers:{Authorization:'Bearer '+token,Origin:'https://blumr.pages.dev'},body:JSON.stringify(body)});
async function sign(raw:string,secret='whsec_synthetic',seconds=now/1000){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(seconds+'.'+raw)));return 't='+seconds+',v1='+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}
const event=()=>({id:'evt_first',type:'invoice.paid',api_version:STRIPE_VERSION,livemode:false,data:{object:{customer:'cus_first',metadata:{user_id:'attacker'}}}});
async function webhook(body:unknown,io:IO,signature?:string){const raw=JSON.stringify(body);return handleStripeWebhook(new Request('https://edge.test/webhook',{method:'POST',headers:{'stripe-signature':signature||await sign(raw)},body:raw}),io);}
const worker=(f:ReturnType<typeof fixture>)=>handleBillingReconcile(new Request('https://edge.test/worker',{method:'POST',headers:{Authorization:'Bearer '+f.env.BILLING_RECONCILE_SECRET}}),f.io);
Deno.test('sandbox disabled and live credentials stop before network or mutation',async()=>{
 const f=fixture();f.env.STRIPE_BILLING_SANDBOX_ENABLED='false';assert((await handleBilling(request({action:'status'}),f.io)).status===200);assert((await handleBilling(request({action:'checkout',tier:'basic'}),f.io)).status===404);assert(f.state.requests.length===0);
 f.env.STRIPE_BILLING_SANDBOX_ENABLED='true';f.env.STRIPE_SECRET_KEY='sk_live_forbidden';assert((await handleBilling(request({action:'checkout',tier:'basic'}),f.io)).status===503);assert(f.state.requests.length===0);
});
Deno.test('billing requires verified Auth; customer, price and return URLs cannot be supplied',async()=>{
 const f=fixture();for(const extra of [{customer:'cus_other'},{price:'price_other'},{return_url:'https://evil.test'},{user_id:'other'}])assert((await handleBilling(request({action:'checkout',tier:'basic',...extra}),f.io)).status===400);
 assert(f.state.requests.length===0);f.state.auth=false;assert((await handleBilling(request({action:'checkout',tier:'basic'}),f.io)).status===401);f.state.auth=true;f.state.verified=false;assert((await handleBilling(request({action:'checkout',tier:'basic'}),f.io)).status===403);assert(f.state.rpc.length===0);
});
Deno.test('checkout pause preserves status, portal and canonical reconciliation',async()=>{
 const f=fixture();f.env.STRIPE_CHECKOUT_PAUSED='true';f.state.row.customer_id='cus_first';f.state.subs=[subscription()];
 assert((await handleBilling(request({action:'checkout',tier:'basic'}),f.io)).status===503);
 assert(f.state.rpc.length===0&&!f.state.checkoutCreates.length,'Paused acquisition mutated billing');
 assert((await handleBilling(request({action:'status'}),f.io)).status===200);
 assert((await handleBilling(request({action:'portal'}),f.io)).status===200);
 assert((await worker(f)).status===200);assert(f.state.rpc.some((r:any)=>r.action==='apply'));
});
Deno.test('checkout owns customer, pins price, and resumes after a lost persistence response',async()=>{
 const f=fixture();f.state.failRPC='checkout_save';assert((await handleBilling(request({action:'checkout',tier:'basic'}),f.io)).status===503);f.state.failRPC=null;
 const retry=await handleBilling(request({action:'checkout',tier:'basic'}),f.io);assert(retry.status===200);assert(f.state.checkoutCreates.length===2);assert(f.state.checkoutCreates[0].key===f.state.checkoutCreates[1].key);assert(f.state.customerCreates.length===1);
 assert(JSON.stringify(f.state.checkoutCreates[0].form)===JSON.stringify(f.state.checkoutCreates[1].form),'Replay changed Stripe parameters');
 assert(f.state.checkoutCreates[0].form.customer==='cus_first');assert(f.state.checkoutCreates[0].form['line_items[0][price]']==='price_basic');
 await handleBilling(request({action:'checkout',tier:'basic'}),f.io);assert(f.state.checkoutCreates.length===2,'Open checkout duplicated');
 assert(f.state.rpc.filter((c:any)=>c.action==='claim').every((c:any)=>c.args.user===user));assert(!f.state.rpc.some((c:any)=>c.action==='apply'),'Redirect granted access');
});
Deno.test('unknown old provisioning outcome requires recovery instead of duplicate customer',async()=>{
 const f=fixture();f.state.row.provision_started_at=new Date(now-24*3600000).toISOString();assert((await handleBilling(request({action:'checkout',tier:'basic'}),f.io)).status===409);assert(f.state.customerCreates.length===0);
});
Deno.test('existing subscriptions and unexpected prices stop checkout',async()=>{
 const f=fixture();f.state.row.customer_id='cus_first';f.state.subs=[subscription()];assert((await handleBilling(request({action:'checkout',tier:'basic'}),f.io)).status===409);assert(!f.state.checkoutCreates.length);
 f.state.subs=[];f.state.price.unit_amount=1;assert((await handleBilling(request({action:'checkout',tier:'basic'}),f.io)).status===503);assert(!f.state.checkoutCreates.length);
});
Deno.test('portal checks sandbox customer and cancellation-only configuration and destination',async()=>{
 const f=fixture();f.state.row.customer_id='cus_first';assert((await handleBilling(request({action:'portal'}),f.io)).status===200);
 f.state.portalUpdates=true;assert((await handleBilling(request({action:'portal'}),f.io)).status===503);f.state.portalUpdates=false;f.state.portalURL='https://billing.stripe.com.evil.test/';assert((await handleBilling(request({action:'portal'}),f.io)).status===503);
 f.state.liveCustomer=true;assert((await handleBilling(request({action:'portal'}),f.io)).status===503);
});
Deno.test('raw signatures enforce freshness, rotation, v1 and exact payload',async()=>{
 const raw=JSON.stringify(event()),signature=await sign(raw);
 assert(await verifySignature(raw,signature,['whsec_old','whsec_synthetic'],now));assert(!await verifySignature(raw+' ',signature,['whsec_synthetic'],now));assert(!await verifySignature(raw,signature,['whsec_synthetic'],now+301000));assert(!await verifySignature(raw,signature.replace('v1=','v0='),['whsec_synthetic'],now));assert(!await verifySignature(raw,signature+',t='+now/1000,['whsec_synthetic'],now));
});
Deno.test('webhook ACK requires durable inbox, excludes payload PII and metadata authority',async()=>{
 const f=fixture();assert((await webhook(event(),f.io)).status===200);const queued=f.state.rpc[0];assert(queued.action==='enqueue'&&queued.args.customer==='cus_first');assert(Object.keys(queued.args).sort().join(',')==='customer,hash,id,type');assert(!JSON.stringify(queued).includes('attacker'));assert(!f.state.requests.some((r:any)=>r.url.includes('api.stripe.com')));
 f.state.failRPC='enqueue';assert((await webhook(event(),f.io)).status===503);
});
Deno.test('live, Connect, wrong-version, tampered and oversize events cannot enqueue',async()=>{
 const f=fixture();for(const value of [{...event(),livemode:true},{...event(),api_version:'old'},{...event(),account:'acct_other'}])assert((await webhook(value,f.io)).status===400);
 assert((await webhook(event(),f.io,'t=1,v1=bad')).status===400);
 const raw='x'.repeat(262145);assert((await handleStripeWebhook(new Request('https://edge.test',{method:'POST',body:raw}),f.io)).status===413);assert(f.state.rpc.length===0);
});
Deno.test('worker requires its private credential before any API request',async()=>{
 const f=fixture();assert((await handleBillingReconcile(request({}),f.io)).status===401);assert(f.state.requests.length===0);
});
Deno.test('canonical paid subscription activates with item-level period; event ordering is irrelevant',async()=>{
 const f=fixture();f.state.row.customer_id='cus_first';f.state.row.checkout_id='operation';f.state.subs=[subscription()];assert((await worker(f)).status===200);
 const applied=f.state.rpc.find((c:any)=>c.action==='apply').args;assert(applied.plan==='basic-v1'&&applied.paid===true&&applied.start===new Date(now-60000).toISOString());assert(f.state.rpc.some((c:any)=>c.action==='checkout_close'));assert(f.state.rpc.at(-1).action==='finish');
});
Deno.test('failed payment pauses access and does not create a paid period',async()=>{
 const f=fixture();f.state.row.customer_id='cus_first';f.state.subs=[subscription()];f.state.invoice.status='open';assert((await worker(f)).status===200);
 const applied=f.state.rpc.find((c:any)=>c.action==='apply').args;assert(applied.status==='past_due'&&!applied.paid&&!applied.start);
});
Deno.test('flexible portal cancellation at the item period end is surfaced without revoking paid access',async()=>{
 const f=fixture();f.state.row.customer_id='cus_first';const sub=subscription();f.state.subs=[sub];
 Object.assign(sub,{cancel_at:sub.items.data[0].current_period_end,cancel_at_period_end:false});
 assert((await worker(f)).status===200);
 const applied=f.state.rpc.find((r:any)=>r.action==='apply').args;
 assert(applied.cancel_at_period_end===true&&applied.status==='active'&&applied.paid===true);
 f.state.claimed=false;f.state.rpc=[];Object.assign(sub,{cancel_at:sub.items.data[0].current_period_end-3600});
 assert((await worker(f)).status===200);assert(f.state.rpc.find((r:any)=>r.action==='apply').args.cancel_at_period_end===false,'Custom earlier cancellation mislabeled');
});
Deno.test('wrong customer, unpaid period evidence, duplicate subscriptions and API outages retain receipts',async()=>{
 for(const alter of [(f:any)=>f.state.invoice.customer='cus_other',(f:any)=>f.state.invoice.lines.data[0].period.end--,(f:any)=>f.state.subs.push({...subscription(),id:'sub_second'}),(f:any)=>f.state.invoice.livemode=true,(f:any)=>f.state.subs[0].items.data[0].quantity=2]){
  const f=fixture();f.state.row.customer_id='cus_first';f.state.subs=[subscription()];alter(f);assert((await worker(f)).status===503);assert(!f.state.rpc.some((c:any)=>c.action==='apply'||c.action==='finish'));assert(f.state.rpc.at(-1).action==='release');
 }
});
Deno.test('cancellation is applied from canonical subscription and not stale invoice events',async()=>{
 const f=fixture();f.state.row.customer_id='cus_first';f.state.row.subscription_id='sub_first';f.state.subs=[{...subscription(),status:'canceled'}];assert((await worker(f)).status===200);assert(f.state.rpc.find((c:any)=>c.action==='apply').args.status==='canceled');assert(!f.state.requests.some((r:any)=>r.url.includes('/invoices/')));
});

Deno.test('canceled checkout is recoverable before its first paid event was reconciled',async()=>{
 const f=fixture();f.state.row.customer_id='cus_first';f.state.row.checkout_id='operation';f.state.row.subscription_id=null;f.state.subs=[{...subscription(),status:'canceled'}];assert((await worker(f)).status===200);assert(f.state.rpc.find((c:any)=>c.action==='apply').args.status==='canceled');assert(f.state.rpc.some((c:any)=>c.action==='checkout_close'));assert(f.state.rpc.at(-1).action==='finish');
});

Deno.test('captured Stripe sandbox paid invoice satisfies canonical reconciliation without network',async()=>{
 const calls:{action:string,args:any}[]=[],s=captured.subscription;
 const client={rpc:async(action:string,args:any={})=>{calls.push({action,args});return {};},stripe:async(path:string)=>{
  if(path==='customers/'+s.customer)return {id:s.customer,livemode:false};
  if(path.startsWith('subscriptions?'))return {data:[s],has_more:false};
  if(path==='invoices/'+captured.invoice.id)return captured.invoice;
  throw Error('Unexpected request '+path);
 }};
 const cfg={live:false,account:undefined,key:'sk_test_fixture',base:'https://example.test',service:'fixture',anon:'fixture',app:'https://example.test/',origin:'https://example.test',prices:{basic:s.items.data[0].price.id,advanced:'price_advanced',pro:'price_pro'},portal:'bpc_fixture'};
 await reconcile({user_id:user,lease_id:'fixture',customer_id:s.customer,checkout_id:s.metadata.blumr_checkout},{...client,risk:async()=>({})},cfg);
 const applied=calls.find(c=>c.action==='apply')?.args;assert(applied.paid===true&&applied.plan==='basic-v1');assert(applied.start===new Date(s.items.data[0].current_period_start*1000).toISOString());assert(calls.at(-1)?.action==='finish');
});

Deno.test('restricted sandbox keys work and live restricted keys fail before network access',async()=>{
 const f=fixture();f.env.STRIPE_SECRET_KEY='rk_test_synthetic';assert((await handleBilling(request({action:'checkout',tier:'basic'}),f.io)).status===200);
 const live=fixture();live.env.STRIPE_SECRET_KEY='rk_live_forbidden';assert((await handleBilling(request({action:'checkout',tier:'basic'}),live.io)).status===503);assert(live.state.requests.length===0);
});

Deno.test('signed-out Auth session is rejected before checkout/portal mutation',async()=>{
 const f=fixture();f.state.sessionValid=false;assert((await handleBilling(request({action:'checkout',tier:'basic'}),f.io)).status===401);assert(!f.state.rpc.length);
 assert((await handleBilling(request({action:'portal'},'malformed'),f.io)).status===401);assert(!f.state.rpc.length);
});
Deno.test('live activation requires explicit project, mode, restricted key and account guard',async()=>{
 for(const alter of [(e:any)=>e.STRIPE_BILLING_MODE='unknown',(e:any)=>{e.STRIPE_BILLING_MODE='live';e.STRIPE_BILLING_LIVE_ENABLED='true';e.STRIPE_SECRET_KEY='rk_live_synthetic';},(e:any)=>e.SUPABASE_URL='https://zqiqjzxcpznhzjengfff.supabase.co']){
  const f=fixture();alter(f.env);assert((await handleBilling(request({action:'checkout',tier:'basic'}),f.io)).status===503);assert(!f.state.requests.length);
 }
});
Deno.test('risk webhooks durably store only IDs and hash without trusting customer metadata',async()=>{
 for(const [type,object] of [['charge.refunded',{id:'ch_test',customer:'cus_attacker'}],['charge.dispute.created',{id:'du_test',charge:'ch_test'}],['charge.dispute.created',{id:'dp_test',charge:'ch_test'}],['radar.early_fraud_warning.created',{id:'issfr_test',charge:'ch_test'}]] as const){
  const f=fixture();assert((await webhook({...event(),type,data:{object}},f.io)).status===200);
  const call=f.state.riskCalls[0];assert(call.action==='enqueue'&&call.args.charge==='ch_test');assert(!JSON.stringify(call).includes('attacker'));assert(!f.state.requests.some((r:any)=>r.url.includes('api.stripe')));
 }
});
Deno.test('risk graph verifies canonical ownership and only current full refunds hold access',async()=>{
 const cfg:any={live:false},calls:any[]=[];let refunded=1000,wrong=false;
 const client:any={risk:async(a:string,args:any)=>calls.push({a,args}),stripe:async(path:string)=>{
  if(path==='charges/ch_test')return {id:'ch_test',livemode:false,paid:true,customer:'cus_first',payment_intent:'pi_test',currency:'usd',amount:2900,amount_refunded:refunded};
  if(path.startsWith('invoice_payments?'))return {has_more:false,data:[{livemode:false,status:'paid',payment:{type:'payment_intent',payment_intent:'pi_test'},invoice:'in_first'}]};
  if(path==='invoices/in_first')return {...invoice(),customer:wrong?'cus_wrong':'cus_first'};
  if(path==='subscriptions/sub_first')return subscription();throw Error('Unexpected graph request');
 }};
 const receipt={id:'evt_risk',lease_id:'lease',charge_id:'ch_test',event_type:'charge.refunded'};
 await reconcileRisk(receipt,client,cfg);assert(calls.at(-1).args.cases[0].hold===false);
 refunded=2900;await reconcileRisk(receipt,client,cfg);assert(calls.at(-1).args.cases[0].hold===true);
 for(const event_type of ['charge.dispute.created','radar.early_fraud_warning.created']){await reconcileRisk({...receipt,event_type},client,cfg);assert(calls.at(-1).args.cases[0].hold===true);}
 wrong=true;const count=calls.length;let rejected=false;try{await reconcileRisk(receipt,client,cfg);}catch{rejected=true;}assert(rejected&&calls.length===count);
});
Deno.test('billing transport refuses credential-bearing redirects',async()=>{
 const f=fixture();await handleBilling(request({action:'checkout',tier:'basic'}),f.io);assert(f.state.requests.every((r:any)=>r.init.redirect==='error'));
});

Deno.test('live rollout checks account identity and limits acquisition to ten explicit users',async()=>{
 const f=fixture();Object.assign(f.env,{STRIPE_BILLING_MODE:'live',STRIPE_BILLING_LIVE_ENABLED:'true',STRIPE_BILLING_SANDBOX_ENABLED:'false',STRIPE_SECRET_KEY:'rk_live_synthetic',SUPABASE_URL:'https://zqiqjzxcpznhzjengfff.supabase.co',BILLING_APP_URL:'https://blumr.io/',STRIPE_ACCOUNT_ID:'acct_expected'});
 const fetch=f.io.fetch;let account='acct_expected';f.io.fetch=async(input,init)=>String(input).endsWith('/v1/account')?Response.json({id:account,charges_enabled:true}):fetch(input,init);
 assert((await handleBilling(request({action:'checkout',tier:'basic'}),f.io)).status===403);assert(!f.state.rpc.length);
 f.env.STRIPE_LIVE_COHORT=user;assert((await handleBilling(request({action:'status'}),f.io)).status===200);
 account='acct_other';assert((await handleBilling(request({action:'checkout',tier:'basic'}),f.io)).status===503);const count=f.state.rpc.length;assert((await worker(f)).status===503);assert(f.state.rpc.length===count);
 account='acct_expected';f.env.STRIPE_LIVE_COHORT=Array(11).fill(user).join(',');assert((await handleBilling(request({action:'checkout',tier:'basic'}),f.io)).status===503);
 f.env.STRIPE_LIVE_COHORT=user;const baseFetch=f.io.fetch;f.io.fetch=async(input,init)=>{if(String(input).includes('api.stripe.com')&&!String(input).endsWith('/account')){const r=await baseFetch(input,init);const body=await r.json();body.livemode=true;return Response.json(body);}return baseFetch(input,init);};
 // Status and acquisition have independent gates; a mode-mismatched object
 // must still fail before a checkout can be accepted.
 assert((await handleBilling(request({action:'checkout',tier:'basic'}),f.io)).status===503);
});
