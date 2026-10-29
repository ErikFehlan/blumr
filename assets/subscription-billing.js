(function(global){
 'use strict';
 function mount(root,api){
  const panel=root.querySelector('#subscriptionBilling');let generation=0,busy=false,state=null;
  if(!panel)return {load:async()=>{},clear:()=>{}};
  function render(message=''){
   panel.hidden=!state?.enabled;
   if(!state?.enabled){panel.replaceChildren();return;}
   const live=state.mode==='live';
   panel.innerHTML='<h3>'+(live?'Billing':'Sandbox billing')+'</h3><p class="rf-sub">'+(live?'':'Test payments only. ')+ ' Your plan updates after payment is verified. Use Refresh billing after returning.</p>'+
    (state.subscription?'<p>Your subscription is managed in billing.'+(state.cancel_at_period_end?' Cancellation is scheduled for the end of your paid period.':'')+'</p>':state.eligible?'<label for="billingTier">Monthly plan</label> <select id="billingTier"><option value="basic">Basic · $29 · 1,000 rules evaluations</option><option value="advanced">Advanced · $79 · 1,000 rules + 100 shortlist AI</option><option value="pro">Pro · $150 · 1,000 rules + 500 deep AI</option></select> <button class="rf-btn" data-billing-action="checkout">'+(state.pending?(live?'Resume checkout':'Resume sandbox checkout'):(live?'Start checkout':'Start sandbox checkout'))+'</button>':'<p>Your account cannot start a new subscription.</p>')+
    (state.customer?' <button class="rf-btn" data-billing-action="portal">Manage billing</button>':'')+
    ' <button class="rf-btn" data-billing-action="refresh">Refresh billing</button><p role="status" data-billing-status></p>';
   if(state.pending_tier&&panel.querySelector('#billingTier'))panel.querySelector('#billingTier').value=state.pending_tier;
   panel.querySelector('[data-billing-status]').textContent=message;
   panel.querySelectorAll('button,select').forEach(el=>el.disabled=busy);
  }
  async function load(){
   const service=api.service(),g=++generation;busy=false;
   if(!service?.billing){state=null;render();return;}
   try{const next=await service.billing('status');if(g!==generation||service!==api.service())return;state=next;render();
    const returned=()=>{
     if(g!==generation||service!==api.service()||!next?.enabled||new URLSearchParams(global.location.search).get('billing')!=='return')return;
     const url=new URL(global.location.href);url.searchParams.delete('billing');global.history.replaceState(global.history.state,'',url);api.openSettings?.();render('Your plan updates after payment is confirmed. If it is still processing, refresh shortly.');
    };
    if(global.document.body.classList.contains('rf-data-loading'))global.addEventListener('ancalagon:data-ready',returned,{once:true});else returned();
   }
   catch{if(g!==generation||service!==api.service())return;if(state?.enabled)render('Billing could not be refreshed. Try again.');}
  }
  panel.addEventListener('click',async event=>{
   const action=event.target.closest('[data-billing-action]')?.dataset.billingAction;if(!action||busy)return;
   if(action==='refresh'){await load();await api.refresh?.();return;}
   const tier=panel.querySelector('#billingTier')?.value,service=api.service(),g=generation;
   if(!service?.billing)return;
   busy=true;panel.querySelectorAll('button,select').forEach(el=>el.disabled=true);panel.querySelector('[data-billing-status]').textContent=state?.mode==='live'?'Opening secure billing…':'Opening secure sandbox billing…';
   try{
    const response=await service.billing(action,tier);
    if(g!==generation||service!==api.service())return;
    const url=new URL(response.url),host=action==='checkout'?'checkout.stripe.com':'billing.stripe.com';
    if(url.protocol!=='https:'||url.hostname!==host||url.username||url.password||url.port)throw Error('Billing returned an invalid destination.');
    api.navigate(url.href);
   }catch(error){if(g===generation&&service===api.service())render(error.message||'Billing could not be opened. Try again.');}
   finally{if(g===generation&&service===api.service()){busy=false;panel.querySelectorAll('button,select').forEach(el=>el.disabled=false);}}
  });
  return {load,clear(){generation++;state=null;busy=false;render();}};
 }
 global.BlumrSubscriptionBilling={mount};
})(window);
