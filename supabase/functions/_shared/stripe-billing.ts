// Sandbox only. Dependency-injected transport keeps lifecycle tests entirely offline.
export const STRIPE_VERSION='2026-09-30.endive';
type Obj=Record<string,any>;
export type IO={env:(name:string)=>string|undefined;fetch:typeof fetch;now:()=>number};
export const runtime:IO={env:name=>Deno.env.get(name),fetch:(...args)=>fetch(...args),now:()=>Date.now()};
export class BillingError extends Error{constructor(message:string,public status=503){super(message);}}
function fail(message='Billing is temporarily unavailable. Try again shortly.',status=503):never{throw new BillingError(message,status);}
const tiers={basic:2900,advanced:7900,pro:15000};
const terminal=new Set(['canceled','incomplete_expired']);
const id=(value:unknown,prefix:string):string=>{if(typeof value!=='string'||value.length>200||!new RegExp('^'+prefix+'_[A-Za-z0-9_]+$').test(value))fail();return value as string;};
const objectId=(value:any)=>typeof value==='string'?value:value?.id;
const sandbox=(value:Obj)=>{if(value?.livemode!==false)fail('Sandbox verification failed.');return value;};
export function stripeURL(value:unknown,kind:'checkout'|'portal'){
 try{const url=new URL(String(value));if(url.protocol==='https:'&&!url.username&&!url.password&&url.port===''&&url.hostname===(kind==='checkout'?'checkout.stripe.com':'billing.stripe.com'))return url.href;}catch{/* fail closed */}
 return fail('Billing returned an invalid destination.');
}
function config(io:IO){
 if(io.env('STRIPE_BILLING_SANDBOX_ENABLED')!=='true')fail('Sandbox billing is not enabled.',404);
 const key=io.env('STRIPE_SECRET_KEY')||'',base=io.env('SUPABASE_URL')||'',service=io.env('SUPABASE_SERVICE_ROLE_KEY')||'',anon=io.env('SUPABASE_ANON_KEY')||'';
 const app=new URL(io.env('BILLING_APP_URL')||'https://invalid.invalid');
 if(io.env('SUBSCRIPTION_FOUNDATION_ENABLED')!=='true'||!key.startsWith('sk_test_')||!service||!anon||!base.startsWith('https://')||app.protocol!=='https:'||app.username||app.password||app.search||app.hash||app.hostname==='invalid.invalid')fail();
 const prices=Object.fromEntries(Object.keys(tiers).map(tier=>[tier,id(io.env('STRIPE_PRICE_'+tier.toUpperCase()),'price')]));
 if(new Set(Object.values(prices)).size!==3)fail();
 return {key,base,service,anon,app:app.href,origin:app.origin,prices,portal:id(io.env('STRIPE_PORTAL_CONFIGURATION_ID'),'bpc')};
}
type Config=ReturnType<typeof config>;
async function boundedText(request:Request,limit:number){
 if(Number(request.headers.get('content-length')||0)>limit)fail('Request too large.',413);
 const reader=request.body?.getReader();if(!reader)return '';
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();fail('Request too large.',413);}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
function ioClient(io:IO,cfg:Config){
 const rpc=async(action:string,args:Obj={})=>{
  const r=await io.fetch(cfg.base+'/rest/v1/rpc/subscription_billing_command',{method:'POST',headers:{apikey:cfg.service,Authorization:'Bearer '+cfg.service,'Content-Type':'application/json'},body:JSON.stringify({p_action:action,p_args:args}),signal:AbortSignal.timeout(12000)});
  if(!r.ok){const error=await r.json().catch(()=>({}));if(error.code==='PT409')fail('Billing is updating or an existing checkout is still open. Refresh and try again.',409);if(error.code==='42501')fail('Your account cannot start billing.',403);fail();}
  return r.json();
 };
 const stripe=async(path:string,form?:Record<string,string>,key?:string)=>{
  const r=await io.fetch('https://api.stripe.com/v1/'+path,{method:form?'POST':'GET',headers:{Authorization:'Bearer '+cfg.key,'Stripe-Version':STRIPE_VERSION,...(form?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(key?{'Idempotency-Key':key}:{})},...(form?{body:new URLSearchParams(form)}:{}),signal:AbortSignal.timeout(12000)});
  if(!r.ok)fail();return r.json();
 };
 return {rpc,stripe};
}
type Client=ReturnType<typeof ioClient>;
function validatePrice(price:Obj,tier:string,cfg:Config,forCheckout=false){
 sandbox(price);
 if(price.id!==cfg.prices[tier]||(forCheckout&&price.active!==true)||price.currency!=='usd'||price.unit_amount!==tiers[tier as keyof typeof tiers]||price.type!=='recurring'||price.recurring?.interval!=='month'||price.recurring?.interval_count!==1||price.recurring?.usage_type!=='licensed'||price.billing_scheme!=='per_unit')fail('Sandbox price configuration needs review.');
}
async function subscriptions(client:Client,customer:string){
 const list=await client.stripe('subscriptions?customer='+encodeURIComponent(customer)+'&status=all&limit=100');
 if(!Array.isArray(list.data)||list.has_more)fail('Subscription history needs review.');
 for(const sub of list.data){sandbox(sub);id(sub.id,'sub');if(objectId(sub.customer)!==customer)fail();}
 const open=list.data.filter((s:Obj)=>!terminal.has(s.status));
 if(open.length>1)fail('Multiple subscriptions need review.');
 return {all:list.data as Obj[],open:open[0] as Obj|undefined};
}
async function ensureCustomer(row:Obj,client:Client,io:IO){
 if(row.customer_id){const customer=sandbox(await client.stripe('customers/'+id(row.customer_id,'cus')));if(customer.id!==row.customer_id||customer.deleted)fail();return row;}
 if(io.now()-Date.parse(row.provision_started_at)>23*3600000)fail('An earlier billing request needs recovery. Contact support.',409);
 const customer=sandbox(await client.stripe('customers',{'metadata[blumr_provision]':row.provision_id},'blumr-customer-'+row.provision_id));
 return client.rpc('customer',{user:row.user_id,lease:row.lease_id,customer:id(customer.id,'cus')});
}
async function checkout(row:Obj,tier:string,client:Client,cfg:Config,io:IO){
 row=await ensureCustomer(row,client,io);
 const existing=await subscriptions(client,row.customer_id);
 if(existing.open)fail('You already have a subscription. Open billing to manage it.',409);
 if(row.checkout_session){
  const session=sandbox(await client.stripe('checkout/sessions/'+id(row.checkout_session,'cs')));
  if(objectId(session.customer)!==row.customer_id||session.id!==row.checkout_session)fail();
  if(session.status==='open'){
   if(row.checkout_tier!==tier)fail('A checkout for another plan is still open. Finish it or wait for it to expire.',409);
   return {url:stripeURL(session.url,'checkout')};
  }
  if(session.status!=='expired')fail('Your payment is being confirmed. Refresh your plan shortly.',409);
  row=await client.rpc('checkout_close',{user:row.user_id,lease:row.lease_id});
 }
 const price=await client.stripe('prices/'+cfg.prices[tier]);validatePrice(price,tier,cfg,true);
 row=await client.rpc('checkout_start',{user:row.user_id,lease:row.lease_id,tier});
 // Never re-create an ambiguous request after Stripe's idempotency retention window.
 if(io.now()-Date.parse(row.checkout_started_at)>23*3600000)fail('An earlier checkout needs recovery. Contact support.',409);
 const session=sandbox(await client.stripe('checkout/sessions',{
  mode:'subscription',customer:row.customer_id,'line_items[0][price]':cfg.prices[row.checkout_tier],'line_items[0][quantity]':'1',
  'allowed_payment_method_types[0]':'card','subscription_data[billing_mode][type]':'flexible','subscription_data[metadata][blumr_checkout]':row.checkout_id,success_url:cfg.app+'?billing=return',cancel_url:cfg.app+'?billing=return',
  expires_at:String(Math.floor(Date.parse(row.checkout_expires_at)/1000)),
 },'blumr-checkout-'+row.checkout_id));
 if(objectId(session.customer)!==row.customer_id||session.mode!=='subscription')fail();
 // Save the ID even if the session expired after a lost response; its terminal
 // state can then be confirmed without guessing whether a charge occurred.
 const url=session.status==='open'?stripeURL(session.url,'checkout'):null;
 await client.rpc('checkout_save',{user:row.user_id,lease:row.lease_id,session:id(session.id,'cs'),url});
 if(!url)fail('Your checkout is being confirmed. Refresh shortly.',409);
 return {url};
}
async function portal(row:Obj,client:Client,cfg:Config){
 if(!row.customer_id)fail('Start a sandbox checkout first.',409);
 const customer=sandbox(await client.stripe('customers/'+id(row.customer_id,'cus')));if(customer.id!==row.customer_id||customer.deleted)fail();
 const settings=sandbox(await client.stripe('billing_portal/configurations/'+cfg.portal));
 const f=settings.features;
 if(settings.id!==cfg.portal||!settings.active||f?.subscription_update?.enabled!==false||f?.subscription_cancel?.enabled!==true||f.subscription_cancel.mode!=='at_period_end'||f?.payment_method_update?.enabled!==true||f?.invoice_history?.enabled!==true)fail('Sandbox portal configuration needs review.');
 const session=await client.stripe('billing_portal/sessions',{customer:id(row.customer_id,'cus'),configuration:cfg.portal,return_url:cfg.app+'?billing=return'});
 // Portal sessions do not expose livemode; customer and configuration were verified.
 if(objectId(session.customer)!==row.customer_id)fail();
 return {url:stripeURL(session.url,'portal')};
}
export async function handleBilling(request:Request,io:IO=runtime){
 const origin=request.headers.get('origin')||'';
 const allowed=new Set(['https://blumr.io','https://blumr.pages.dev','https://erikfehlan.github.io']);
 try{const value=io.env('BILLING_APP_URL');if(value)allowed.add(new URL(value).origin);}catch{/* no extra origin */}
 const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',...(allowed.has(origin)?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'}:{})};
 const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(origin&&!allowed.has(origin))return json({error:'Origin not allowed'},403);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 let row:Obj|undefined,client:Client|undefined;
 try{
  let body:Obj;try{body=JSON.parse(await boundedText(request,2048));}catch(e){if(e instanceof BillingError)throw e;return json({error:'Invalid request'},400);}
  if(!body||!['status','checkout','portal'].includes(body.action)||Object.keys(body).some(k=>!['action','tier'].includes(k))||(body.action==='checkout'&&!Object.hasOwn(tiers,body.tier))||(body.action!=='checkout'&&body.tier!==undefined))return json({error:'Invalid request'},400);
  if(body.action==='status'&&io.env('STRIPE_BILLING_SANDBOX_ENABLED')!=='true')return json({enabled:false});
  const cfg=config(io);client=ioClient(io,cfg);
  const bearer=request.headers.get('authorization')||'';if(!/^Bearer \S+$/i.test(bearer))return json({error:'Sign in required'},401);
  const auth=await io.fetch(cfg.base+'/auth/v1/user',{headers:{apikey:cfg.anon,Authorization:bearer},signal:AbortSignal.timeout(12000)});
  if(!auth.ok)return json({error:'Sign in again to manage billing'},401);
  const user=await auth.json();if(typeof user.id!=='string'||!user.email_confirmed_at)return json({error:'Verify your account first'},403);
  if(body.action==='status')return json({enabled:true,...await client.rpc('status',{user:user.id})});
  row=await client.rpc('claim',{user:user.id,purpose:body.action});
  return json(body.action==='checkout'?await checkout(row!,body.tier,client,cfg,io):await portal(row!,client,cfg));
 }catch(e){return json({error:e instanceof BillingError?e.message:'Billing is temporarily unavailable. Try again shortly.'},e instanceof BillingError?e.status:503);}
 finally{if(row&&client)await client.rpc('release',{user:row.user_id,lease:row.lease_id}).catch(()=>{});}
}
const encoder=new TextEncoder();
export async function verifySignature(raw:string,header:string,secrets:string[],now:number){
 const parts=header.split(',').map(p=>p.trim().split('='));const timestamps=parts.filter(p=>p[0]==='t');
 if(timestamps.length!==1||!/^\d+$/.test(timestamps[0][1]))return false;
 const t=Number(timestamps[0][1]);if(!Number.isSafeInteger(t)||Math.abs(now/1000-t)>300)return false;
 const signatures=parts.filter(p=>p[0]==='v1'&&/^[a-f0-9]{64}$/.test(p[1])).map(p=>Uint8Array.from(p[1].match(/../g)!,v=>parseInt(v,16)));
 for(const secret of secrets){const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);for(const signature of signatures){if(await crypto.subtle.verify('HMAC',key,signature,encoder.encode(t+'.'+raw)))return true;}}
 return false;
}
const eventTypes=new Set(['checkout.session.completed','checkout.session.expired','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','customer.subscription.paused','customer.subscription.resumed','customer.subscription.pending_update_applied','customer.subscription.pending_update_expired','invoice.paid','invoice.payment_failed','invoice.payment_action_required','invoice.finalization_failed']);
export async function handleStripeWebhook(request:Request,io:IO=runtime){
 if(request.method!=='POST')return Response.json({error:'Method not allowed'},{status:405});
 try{
  const cfg=config(io),secrets=[io.env('STRIPE_WEBHOOK_SECRET'),io.env('STRIPE_WEBHOOK_SECRET_PREVIOUS')].filter((s):s is string=>!!s&&s.startsWith('whsec_'));
  if(!secrets.length)fail();
  const raw=await boundedText(request,262144);
  if(!await verifySignature(raw,request.headers.get('stripe-signature')||'',secrets,io.now()))return Response.json({error:'Invalid signature'},{status:400});
  let event:Obj;try{event=JSON.parse(raw);}catch{return Response.json({error:'Invalid event'},{status:400});}
  if(event.livemode!==false||event.api_version!==STRIPE_VERSION||event.account)return Response.json({error:'Unsupported event mode or version'},{status:400});
  if(!eventTypes.has(event.type))return Response.json({ignored:true});
  const customer=id(objectId(event.data?.object?.customer),'cus');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(raw))),b=>b.toString(16).padStart(2,'0')).join('');
  await ioClient(io,cfg).rpc('enqueue',{id:id(event.id,'evt'),customer,type:event.type,hash});
  return Response.json({queued:true}); // Only a durable receipt is acknowledged.
 }catch(e){return Response.json({error:'Webhook could not be accepted'},{status:e instanceof BillingError?e.status:503});}
}
export async function reconcile(row:Obj,client:Client,cfg:Config){
 const customer=sandbox(await client.stripe('customers/'+id(row.customer_id,'cus')));if(customer.id!==row.customer_id||customer.deleted)fail();
 const list=await subscriptions(client,row.customer_id);
 const sub=list.open||list.all.find(s=>row.checkout_id&&s.metadata?.blumr_checkout===row.checkout_id)||list.all.find(s=>s.id===row.subscription_id);
 if(row.subscription_id&&!sub)fail('Subscription history needs review.');
 if(sub){
  const args:Obj={user:row.user_id,lease:row.lease_id,subscription:sub.id,status:sub.status,cancel_at_period_end:sub.cancel_at_period_end===true};
  if(sub.status==='active'){
   if(sub.pause_collection||sub.pending_update)fail('Subscription update is pending.');
   if(sub.collection_method!=='charge_automatically'||sub.items?.has_more||sub.items?.data?.length!==1)fail('Subscription configuration needs review.');
   const item=sub.items.data[0],price=item.price,tier=Object.keys(cfg.prices).find(t=>cfg.prices[t]===price?.id);
   if(!tier||item.quantity!==1)fail('Subscription price needs review.');validatePrice(price,tier,cfg);
   const start=item.current_period_start,end=item.current_period_end;
   if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||end<=start)fail();
   const invoice=sandbox(await client.stripe('invoices/'+id(objectId(sub.latest_invoice),'in')));
   if(objectId(invoice.customer)!==row.customer_id||objectId(invoice.parent?.subscription_details?.subscription)!==sub.id)fail();
   if(invoice.status!=='paid'){args.status='past_due';}
   else{
    if(invoice.currency!=='usd'||invoice.lines?.has_more||!invoice.lines?.data?.some((line:Obj)=>line.livemode===false&&line.parent?.subscription_item_details?.subscription_item===item.id&&line.parent.subscription_item_details.proration===false&&line.pricing?.price_details?.price===price.id&&line.quantity===1&&line.period?.start===start&&line.period?.end===end))fail('Paid period needs review.');
    Object.assign(args,{paid:true,plan:tier+'-v1',start:new Date(start*1000).toISOString(),end:new Date(end*1000).toISOString()});
   }
  }
  await client.rpc('apply',args);
  if(row.checkout_id&&sub.metadata?.blumr_checkout===row.checkout_id)await client.rpc('checkout_close',{user:row.user_id,lease:row.lease_id});
 }
 if(row.checkout_session){
  const session=sandbox(await client.stripe('checkout/sessions/'+id(row.checkout_session,'cs')));
  if(objectId(session.customer)!==row.customer_id||session.id!==row.checkout_session)fail();
  if(session.status==='expired'||(session.status==='complete'&&sub&&objectId(session.subscription)===sub.id))await client.rpc('checkout_close',{user:row.user_id,lease:row.lease_id});
 }
 // Ambiguous checkout creation is recovered by replaying the original interactive
 // operation; never discard its identity merely because its local expiry passed.
 await client.rpc('finish',{user:row.user_id,lease:row.lease_id});
}
async function equalSecret(a:string,b:string){
 const dig=async(s:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(s)));
 const [x,y]=await Promise.all([dig(a),dig(b)]);let difference=0;for(let i=0;i<x.length;i++)difference|=x[i]^y[i];return difference===0;
}
export async function handleBillingReconcile(request:Request,io:IO=runtime){
 if(request.method!=='POST')return Response.json({error:'Method not allowed'},{status:405});
 const secret=io.env('BILLING_RECONCILE_SECRET')||'';
 if(secret.length<32||!await equalSecret(request.headers.get('authorization')||'','Bearer '+secret))return Response.json({error:'Unauthorized'},{status:401});
 try{
  const cfg=config(io),client=ioClient(io,cfg);let completed=0,failed=0;
  // Bound each invocation to fit the Edge wall-clock budget; concurrent workers
  // use SKIP LOCKED and lease fencing. Pending receipts survive all failures.
  for(let i=0;i<1;i++){
   const row=await client.rpc('claim_next');if(!row)break;
   try{await reconcile(row,client,cfg);completed++;}catch{failed++;await client.rpc('release',{user:row.user_id,lease:row.lease_id,error:'retry'}).catch(()=>{});}
  }
  return Response.json({completed,failed},{status:failed?503:200});
 }catch{return Response.json({error:'Reconciliation unavailable'},{status:503});}
}
