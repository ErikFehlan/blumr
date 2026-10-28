(function(global){
 'use strict';
 const copy=value=>JSON.parse(JSON.stringify(value));
 function buildChange(snapshot,values,{id,now=Date.now()}={}){
  if(!snapshot?.user?.id||!snapshot.version)throw Error('Find the registered account first.');
  if(snapshot.account?.source==='stripe')throw Error('Billing-managed subscriptions cannot be changed here.');
  const action=values.action,reason=String(values.reason||'').trim();
  if(!['save','renew','pause'].includes(action)||reason.length<10||reason.length>500)throw Error('Choose an action and explain the change in 10–500 characters.');
  const request={p_request:id||global.crypto.randomUUID(),p_user:snapshot.user.id,p_expected_version:snapshot.version,p_action:action,p_plan:null,p_status:null,p_expires:null,p_reason:reason};
  if(action==='pause'){if(!snapshot.account)throw Error('This account has no subscription to pause.');return request;}
  if(!snapshot.user.eligible)throw Error('The account needs verified, approved access before a plan can be granted.');
  if(!snapshot.plans?.some(p=>p.code===values.plan)||!['beta','trialing','complimentary'].includes(values.status))throw Error('Choose an available plan and access type.');
  const expires=Date.parse(values.expires),end=Date.parse(snapshot.account?.period?.ends_at),start=Date.parse(snapshot.account?.period?.starts_at);
  if(!Number.isFinite(expires)||expires<=now||expires>now+366*86400000)throw Error('Choose an end time within the next year.');
  if(action==='renew'&&(!snapshot.account?.period||end>now))throw Error('A new allowance period is available only after the current period ends.');
  if(action==='save'&&snapshot.account?.period&&(end<=now||start>now))throw Error('The allowance period is inactive. Choose Renew expired access.');
  return {...request,p_plan:values.plan,p_status:values.status,p_expires:new Date(expires).toISOString()};
 }
 function createSession(api){
  let generation=0,state={phase:'empty',snapshot:null,request:null,error:'',message:''};
  const view=()=>copy(state),emit=()=>api.changed?.(view());
  const denied=error=>['42501','PGRST301'].includes(error?.code)||[401,403].includes(error?.status);
  function clear(){generation++;state={phase:'empty',snapshot:null,request:null,error:'',message:''};emit();}
  async function lookup(email){
   const g=++generation;state={phase:'loading',snapshot:null,request:null,error:'',message:''};emit();
   try{const snapshot=await api.find(email.trim());if(g!==generation)return;state={phase:snapshot?'ready':'empty',snapshot,request:null,error:'',message:snapshot?'':'No unique registered account matches that email.'};}
   catch(error){if(g!==generation)return;if(denied(error)){clear();api.denied?.();return;}state={...state,phase:'empty',error:error.code==='PGRST202'?'Subscription administration is not available in this environment yet.':error.message||'Account lookup failed. Try again.'};}
   emit();
  }
  function prepare(values){if(state.phase==='saving'||state.phase==='conflict')throw Error('Reload the account before preparing another change.');state={...state,request:buildChange(state.snapshot,values),phase:'review',error:'',message:''};emit();}
  function cancel(){if(state.phase==='saving')return;state={...state,request:null,phase:state.snapshot?'ready':'empty',error:'',message:''};emit();}
  async function save(){
   if(!state.request||!['review'].includes(state.phase))return;
   const g=generation,request=copy(state.request);state={...state,phase:'saving',error:''};emit();
   try{const result=await api.change(request);if(g!==generation)return;if(!result?.snapshot||result.snapshot.user.id!==request.p_user)throw Error('The saved account could not be verified. Retry the same change.');
    state={phase:'ready',snapshot:result.snapshot,request:null,error:'',message:result.replayed?'Change confirmed. No duplicate grant was created.':'Access change saved.'};emit();api.saved?.(copy(result.snapshot));
   }catch(error){if(g!==generation)return;if(denied(error)){clear();api.denied?.();return;}state={...state,phase:error.code==='PT409'?'conflict':'review',error:error.code==='PT409'?'This subscription changed. Your inputs are retained. Reload the account before saving.':(error.message||'The change could not be confirmed.')+' Retry to confirm this same change.'};emit();}
  }
  return {view,lookup,prepare,cancel,save,clear};
 }
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const label=value=>({basic:'Basic',advanced:'Advanced',pro:'Pro',beta:'Beta',trialing:'Trial',complimentary:'Complimentary',paused:'Paused',save:'Grant or update access',renew:'Renew expired access',pause:'Pause new evaluations'}[value]||value);
 const date=value=>value?new Date(value).toLocaleString():'—';
 function localInput(value){const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
 function mount(host,api){
  host.innerHTML='<h3>Subscription access</h3><p class="rf-sub">Assign non-billable beta, trial, or complimentary access to a registered user. These controls do not charge a card or change signup approval.</p><form class="rf-form subscription-admin-search"><label>Registered email<input type="email" autocomplete="off" required maxlength="320" data-sub-email></label><button class="rf-btn" type="submit">Find account</button></form><p role="status" aria-live="polite" data-sub-status></p><div data-sub-account></div>';
  const search=host.querySelector('form'),email=host.querySelector('[data-sub-email]'),status=host.querySelector('[data-sub-status]'),body=host.querySelector('[data-sub-account]');let displayed=null;
  const session=createSession({...api,changed:render});
  function render(view){
   if(!host.isConnected||api.allowed?.()===false)return;
   status.textContent=view.error||view.message||(view.phase==='loading'?'Finding account…':view.phase==='saving'?'Saving access change…':'');
   search.querySelector('button').disabled=view.phase==='saving';email.disabled=view.phase==='saving';
   if(!view.snapshot){body.replaceChildren();displayed=null;return;}
   const snapshot=view.snapshot,a=snapshot.account;
   if(displayed!==snapshot.version+'|'+snapshot.user.id){
    displayed=snapshot.version+'|'+snapshot.user.id;
    const period=a?.period,expired=period&&Date.parse(period.ends_at)<=Date.now(),manual=!a||a.source==='manual';
    body.innerHTML=`<div class="subscription-admin-identity"><h4>${escape(snapshot.user.email)}</h4><p>${a?escape(label(a.tier)+' · '+label(a.status)):'No subscription assigned'}</p>${period?`<p class="rf-sub">Current allowance: ${escape(date(period.starts_at))} – ${escape(date(period.ends_at))}</p>`:''}${!snapshot.user.eligible?'<p class="rf-note">This user needs verified, approved account access before a plan can be granted.</p>':''}</div>${a?`<h4>Current evaluation allowance</h4><div class="rf-tablewrap"><table class="rf-table" aria-label="Current evaluation allowance"><thead><tr><th>Evaluation</th><th>Completed</th><th>Pending</th><th>Remaining</th></tr></thead><tbody>${[['rules','Rules'],['shortlist_ai','Shortlist AI'],['deep_ai','Deep AI']].map(([key,name])=>{const u=a.usage[key];return `<tr><td>${name}</td><td>${u.used}</td><td>${u.pending}</td><td>${u.remaining} / ${u.limit}</td></tr>`;}).join('')}</tbody></table></div>`:''}${manual?`<form class="rf-form subscription-admin-edit"><div class="subscription-admin-fields"><label>Action<select name="action"><option value="save" ${expired?'disabled':''}>Grant or update access</option><option value="renew" ${expired?'selected':'disabled'}>Renew expired access</option><option value="pause" ${a?'':'disabled'}>Pause new evaluations</option></select></label><label>Plan<select name="plan">${snapshot.plans.map(p=>`<option value="${escape(p.code)}" ${p.code===a?.plan_code?'selected':''}>${escape(label(p.tier))}</option>`).join('')}</select></label><label>Access type<select name="status">${['beta','trialing','complimentary'].map(s=>`<option value="${s}" ${s===a?.status?'selected':''}>${label(s)}</option>`).join('')}</select></label><label>Access and allowance end (${escape(Intl.DateTimeFormat().resolvedOptions().timeZone)})<input name="expires" type="datetime-local" required value="${escape(localInput(!expired&&a?.access_until||Date.now()+30*86400000))}"></label></div><p class="rf-note" data-sub-effect>Updating or extending an active period keeps completed and pending usage. Renewing an expired period starts a fresh allowance. Existing results are retained; work already running may finish.</p><label>Reason for this change<textarea name="reason" required minlength="10" maxlength="500" placeholder="For example: 30-day Advanced trial for the recruiting beta"></textarea></label><button class="rf-btn primary" type="submit">Review change</button></form><div data-sub-review></div>`:'<p class="rf-note">This subscription is managed by billing. Manual access changes are unavailable here.</p>'}<details class="subscription-admin-history"><summary>Change history (${snapshot.history.length}${snapshot.history.length===20?' most recent':''})</summary>${snapshot.history.length?'<ol>'+snapshot.history.map(h=>`<li><strong>${escape(label(h.action))}</strong> · ${escape(date(h.created_at))}<p>${escape(h.actor_email||h.actor_id||'Deleted administrator')}</p><p>${escape(h.reason)}</p><p class="rf-sub">${escape(h.before_state?label(h.before_state.tier)+' / '+label(h.before_state.status):'Unassigned')} → ${escape(label(h.after_state.tier)+' / '+label(h.after_state.status))} · Ends ${escape(date(h.after_state.access_until))}</p></li>`).join('')+'</ol>':'<p class="rf-sub">No manual access changes recorded.</p>'}</details>`;
    const form=body.querySelector('.subscription-admin-edit');
    if(form){
     const action=form.elements.action;
     const update=()=>{for(const key of ['plan','status','expires'])form.elements[key].disabled=action.value==='pause';};action.addEventListener('change',update);update();
     form.addEventListener('submit',e=>{e.preventDefault();try{session.prepare({action:action.value,plan:form.elements.plan.value,status:form.elements.status.value,expires:form.elements.expires.value,reason:form.elements.reason.value});}catch(error){status.textContent=error.message;}});
    }
   }
   const form=body.querySelector('.subscription-admin-edit'),review=body.querySelector('[data-sub-review]');
   if(form){const locked=!!view.request;for(const input of form.querySelectorAll('input,select,textarea,button'))input.disabled=locked||form.elements.action.value==='pause'&&['plan','status','expires'].includes(input.name);}
   if(!review)return;
   const request=view.request;
   if(!request){review.replaceChildren();return;}
   const plan=snapshot.plans.find(p=>p.code===request.p_plan);
   review.innerHTML=`<section class="rf-note subscription-admin-review"><h4>Review access change</h4><p><strong>${escape(snapshot.user.email)}</strong></p><p>${escape(label(request.p_action))}${plan?' · '+escape(label(plan.tier))+' · '+escape(label(request.p_status)):''}</p>${request.p_expires?`<p>Ends ${escape(date(request.p_expires))}.</p><p>${request.p_action==='renew'?'A new allowance period will begin. Historical usage stays recorded.':'Current-period usage will not reset.'}</p>`:'<p>New evaluations will pause. Saved work and usage remain available.</p>'}<p>${escape(request.p_reason)}</p><div class="rf-actions"><button class="rf-btn primary" data-sub-apply ${view.phase==='saving'||view.phase==='conflict'?'disabled':''}>${view.phase==='saving'?'Saving…':view.error?'Retry same change':'Apply access change'}</button>${view.phase==='conflict'?'<button class="rf-btn" data-sub-reload>Reload account</button>':`<button class="rf-btn" data-sub-cancel ${view.phase==='saving'?'disabled':''}>Edit change</button>`}</div></section>`;
   review.querySelector('[data-sub-apply]').onclick=()=>void session.save();
   review.querySelector('[data-sub-cancel]')?.addEventListener('click',()=>session.cancel());
   review.querySelector('[data-sub-reload]')?.addEventListener('click',()=>void session.lookup(snapshot.user.email));
  }
  search.addEventListener('submit',e=>{e.preventDefault();void session.lookup(email.value);});
  email.addEventListener('input',()=>session.clear());
  return session;
 }
 const exported={buildChange,createSession,mount};if(typeof module==='object'&&module.exports)module.exports=exported;global.BlumrSubscriptionAdmin=exported;
})(globalThis);
