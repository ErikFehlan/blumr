(function(global){
 'use strict';
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const labels={external:'External recruiters',internal:'Internal accounts',test:'Test accounts',unreviewed:'Unreviewed accounts'};
 const count=value=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0;
 function rate(n,d){n=count(n);d=count(d);return d?`${n} / ${d} (${Math.round(n/d*100)}%)`:'Not mature yet';}
 function html(report){
  const cohorts=report.cohorts||[],external=cohorts.find(c=>c.cohort==='external')||{},unreviewed=cohorts.find(c=>c.cohort==='unreviewed')||{};
  const row=(label,a,b)=>`<tr><th scope="row">${label}</th><td>${a}</td><td>${b}</td></tr>`;
  return '<h3>Recruiter retention</h3><p class="rf-sub">Only accounts reviewed as external recruiters appear in these results. '+count(unreviewed.accounts)+' accounts still need cohort review.</p>'+
   '<div class="rf-admin-activation"><div><strong>'+count(external.accounts)+'</strong><span>External accounts</span></div><div><strong>'+count(external.activated)+'</strong><span>First tracked assessment</span></div><div><strong>'+count(external.second_assessment)+'</strong><span>Second candidate assessed</span></div><div><strong>'+(external.median_hours_to_second==null?'—':count(external.median_hours_to_second).toFixed(1)+' h')+'</strong><span>Median first → second · '+count(external.second_assessment)+' completers</span></div></div>'+
   '<div class="rf-tablewrap"><table class="rf-table"><caption>External recruiter returns after the first tracked assessment</caption><thead><tr><th>Activity on a later day</th><th>Within 7 days</th><th>Within 30 days</th></tr></thead><tbody>'+
   row('Saved work',rate(external.returned_7d,external.eligible_7d),rate(external.returned_30d,external.eligible_30d))+
   row('Comparison viewed · browser observed',rate(external.comparison_return_7d,external.eligible_7d),rate(external.comparison_return_30d,external.eligible_30d))+
   row('Submittal saved',rate(external.submittal_return_7d,external.eligible_7d),rate(external.submittal_return_30d,external.eligible_30d))+'</tbody></table></div>'+
   '<details><summary>How these numbers are measured</summary><p class="rf-sub">Each denominator includes only recruiters with a full 7 or 30 days of follow-up. A return requires a later calendar day in America/New_York. Logins, background AI work and refreshes do not count as saved work. Comparisons are browser observations, not confirmed saves.</p>'+
   '<p class="rf-sub">Tracking started '+escape(report.tracking_started_at?new Date(report.tracking_started_at).toLocaleString():'with this release')+'. First and second refer to distinct candidates observed since that date, including existing users. Earlier activity is not reconstructed; repeat analysis of one candidate is not a second candidate. Saved submittals do not establish that anything was sent.</p></details>'+
   '<details><summary>Review account cohorts</summary><p class="rf-sub">Classify known recruiters before interpreting external retention. Admins and reserved test accounts are automatically excluded. Changes apply to this report’s full tracked history.</p><div class="rf-tablewrap"><table class="rf-table"><thead><tr><th>Account</th><th>Cohort</th><th></th></tr></thead><tbody>'+
   (report.accounts||[]).map(a=>'<tr><td>'+escape(a.email||'Account')+'</td><td>'+(a.locked?escape(labels[a.cohort]||a.cohort):'<select aria-label="Cohort for '+escape(a.email||'account')+'" data-retention-user="'+escape(a.id)+'">'+Object.entries(labels).map(([key,label])=>'<option value="'+key+'"'+(a.cohort===key?' selected':'')+'>'+label+'</option>').join('')+'</select>')+'</td><td>'+(a.locked?'Automatic':'<button type="button" class="rf-btn" data-retention-save="'+escape(a.id)+'">Save cohort</button>')+'</td></tr>').join('')+'</tbody></table></div></details><p class="rf-sub" data-retention-status role="status">Updated '+escape(new Date(report.generated_at).toLocaleString())+'.</p>';
 }
 function render(host,report,{saveCohort,refresh,onDenied}={}){
  if(!report){
   let status=host.querySelector('[data-retention-status]');
   if(!status){host.innerHTML='<h3>Recruiter retention</h3><p class="rf-sub" data-retention-status role="status"></p>';status=host.querySelector('[data-retention-status]');}
   status.textContent='Retention reporting could not refresh. Any displayed figures may be out of date. Try Refresh again.';return;
  }
  host.innerHTML=html(report);
  host.onclick=async event=>{
   const button=event.target.closest('[data-retention-save]');if(!button||!host.contains(button)||!saveCohort)return;
   const id=button.dataset.retentionSave,select=Array.from(host.querySelectorAll('[data-retention-user]')).find(x=>x.dataset.retentionUser===id),status=host.querySelector('[data-retention-status]');
   button.disabled=true;select.disabled=true;status.textContent='Saving cohort…';
   try{await saveCohort(id,select.value);if(host.isConnected&&button.isConnected)await refresh?.();}
   catch(error){if(!host.isConnected||!button.isConnected)return;if(['42501','PGRST301'].includes(error?.code)){onDenied?.();return;}status.textContent='Cohort was not saved. Try again.';}
   finally{if(button.isConnected){button.disabled=false;select.disabled=false;}}
  };
 }
 const api={html,rate,render};if(typeof module!=='undefined'&&module.exports)module.exports=api;global.BlumrRetention=api;
})(typeof window==='undefined'?globalThis:window);
