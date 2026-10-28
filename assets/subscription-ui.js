(function(global){
 'use strict';
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function mount(root,api){
  const panel=root.querySelector('#subscriptionPanel'),content=root.querySelector('#subscriptionContent'),refresh=root.querySelector('#subscriptionRefresh'),capacity=root.querySelector('#subscriptionCapacity');
  const session=global.BlumrSubscriptions.createSession({load:()=>api.service()?.loadSubscription?.()??Promise.resolve(null),changed:render});
  function render(view){
   const {phase,plan,refreshing}=view,legacy=phase==='legacy',ready=phase==='ready';
   panel.hidden=legacy||phase==='idle'&&!refreshing;refresh.disabled=refreshing;
   root.querySelector('#teamPlan').hidden=!legacy;
   root.querySelector('#teamSettingsHeading').textContent='Team';
   capacity.hidden=legacy||phase==='idle'&&!refreshing;
   if(!ready){
    content.innerHTML=`<p role="status">${phase==='error'?'Your plan and usage could not be loaded. Refresh to try again.':'Loading your plan and usage…'}</p>`;
    capacity.innerHTML=phase==='error'?'<span>Usage unavailable.</span> <button class="rf-linkbtn" data-plan-refresh>Retry</button>':'<span>Checking your evaluation allowance…</span>';
   }else{
    const valid=global.BlumrSubscriptions.active(plan),name=plan.tier[0].toUpperCase()+plan.tier.slice(1);
    const status=valid?({trialing:'Trial',beta:'Beta access',complimentary:'Complimentary'}[plan.status]||'Active'):'Evaluations paused';
    const rows=global.BlumrSubscriptions.metrics(plan),date=plan.period_ends_at?api.date(plan.period_ends_at):'';
    content.innerHTML=`<div class="subscription-heading"><div><span class="rf-kicker">Your plan</span><h4>${name}</h4></div><span class="rf-pill ${valid?'rf-green':'rf-amber'}">${status}</span></div><p class="rf-sub">Your allowance follows your account across workspaces.${date?' Current period ends '+esc(date)+'.':''}</p>${!valid?'<p class="rf-note">New evaluations are paused. Your saved candidates, notes, and results remain available.</p>':''}<div class="subscription-metrics">${rows.map(row=>`<section class="subscription-metric" aria-label="${esc(row.label)}"><h5>${esc(row.label)}</h5><p class="subscription-number"><strong>${row.remaining.toLocaleString()}</strong> remaining <span>of ${row.limit.toLocaleString()}</span></p><progress max="${Math.max(1,row.limit)}" value="${Math.min(row.limit,row.used+row.pending)}" aria-label="${esc(row.label)} used or pending">${row.used+row.pending} of ${row.limit}</progress><p class="rf-sub">${row.used.toLocaleString()} completed · ${row.pending.toLocaleString()} pending</p>${row.remaining===0?'<p class="subscription-exhausted">Allowance reached. Saved work is retained.</p>':''}</section>`).join('')}</div><p class="rf-sub">${plan.tier==='basic'?'Basic uses rules-based screening. Feedback and clarifications are written by you; no AI is used.':plan.tier==='advanced'?'AI review is limited to selected finalists.':'Deep AI evaluations use your deep-evaluation allowance.'}</p><details class="subscription-counting"><summary>How evaluations are counted</summary><p>Only a completed, saved evaluation uses an allowance. Pending work holds a place until its outcome is confirmed. Reopening an unchanged result does not use another evaluation. Changed evidence or requirements may need a new evaluation.</p></details>`;
    capacity.innerHTML=`<span><strong>${name}</strong> · ${valid?rows.map(row=>`${row.remaining.toLocaleString()} ${row.key==='rules'?'rules':row.key==='deep_ai'?'deep AI':'shortlist AI'} remaining`).join(' · '):'Evaluations paused'}</span><button class="rf-linkbtn" data-plan-open>Plan &amp; usage</button>`;
   }
   const manual=global.BlumrSubscriptions.policy(view)==='manual';
   root.querySelector('#feedbackHelp').textContent=manual?'Save your original note and add your own clarification. Reusable preferences need your approval.':'A short note is enough. We’ll save your words first, then draft an interpretation using this job’s context. You can correct it.';
   root.querySelector('#feedbackPlanNote').textContent=manual?'Your note is saved as evidence. Approved reusable preferences update rules screening; no AI interpretation or reassessment is requested.':'Saving your note prepares an assessment proposal automatically. Review and approve the proposed scores on the candidate or job dashboard.';
   api.changed?.(view);
  }
  refresh.addEventListener('click',()=>void session.load());
  capacity.addEventListener('click',e=>{if(e.target.closest('[data-plan-refresh]'))void session.load();if(e.target.closest('[data-plan-open]')){api.navigate('backend');panel.scrollIntoView({block:'start'});root.querySelector('#subscriptionHeading').focus({preventScroll:true});void session.load();}});
  return session;
 }
 global.BlumrSubscriptionUI={mount};
})(window);
