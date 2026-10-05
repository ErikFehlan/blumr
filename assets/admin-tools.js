(function(global){
 'use strict';
 function create({host,load,download,authorize,getSettings,saveSettings,onDenied,toast,saveFile,supportLoad,supportReview,securityLoad,securityAccess,securityPause,reminderLoad,reminderSave,reminderSend,planLoad,planSave,ratesLoad,ratesSave,costLoad,healthLoad,recoveryLoad,recoveryRetry}){
  let allowed=false,version=0,loading=null;
  const files={downloadServer:'server',downloadSchema:'schema',downloadPrompt:'prompt',downloadPackage:'pkg',downloadEnv:'env'};
  function clear(){version++;loading=null;host.replaceChildren();}
  function setAllowed(value){allowed=value===true;if(!allowed)clear();}
  function deny(){setAllowed(false);onDenied();}
  function message(text,retry=false){
   host.replaceChildren();const note=document.createElement('p');note.className='rf-note';note.setAttribute('role','status');note.textContent=text;host.append(note);
   if(retry){const button=document.createElement('button');button.type='button';button.className='rf-btn';button.dataset.adminRetry='true';button.textContent='Retry';host.append(button);}
  }
  async function open(){
   if(!allowed){clear();return;}
   if(loading)return loading;
   const request=++version;message('Loading admin tools…');
   loading=(async()=>{
    try{
     const payload=await load();
     if(!allowed||request!==version)return;
     if(typeof payload?.html!=='string')throw Error('Admin tools are unavailable.');
     // This markup is a deployment-owned resource returned by an admin-checked RPC.
     host.innerHTML=payload.html;
     const technical=document.createElement('div');technical.append(...Array.from(host.childNodes));
     host.replaceChildren();
     const tabs=document.createElement('nav');tabs.className='rf-admin-tabs';tabs.setAttribute('aria-label','Admin areas');host.append(tabs);
     const areas={};
     for(const [key,label] of [['overview','Overview'],['health','System'],['users','Users'],['emails','Communications'],['usage','Usage'],['rewards','Rewards'],['advanced','Technical setup']]){
      const button=document.createElement('button');button.type='button';button.className='rf-admin-tab';button.textContent=label;button.dataset.adminArea=key;button.setAttribute('aria-pressed',key==='overview'?'true':'false');tabs.append(button);
      const area=document.createElement('div');area.className='rf-admin-area';area.dataset.adminPanel=key;area.hidden=key!=='overview';host.append(area);areas[key]=area;
     }
     const showArea=key=>{for(const [name,area] of Object.entries(areas))area.hidden=name!==key;for(const button of tabs.querySelectorAll('button'))button.setAttribute('aria-pressed',button.dataset.adminArea===key?'true':'false');};
     tabs.addEventListener('click',event=>{const key=event.target.closest('button')?.dataset.adminArea;if(key&&areas[key])showArea(key);});
     const heading=document.createElement('h3');heading.textContent='Admin overview';areas.overview.append(heading);
     const summary=document.createElement('div');summary.className='rf-admin-summary';
     for(const [key,label] of [['users','Beta users'],['emails','Weekly recipients'],['support','Open reports'],['usage','AI calls today']]){
      const card=document.createElement('button');card.type='button';card.className='rf-admin-summary-card';card.dataset.adminJump=key==='support'?'users':key;card.innerHTML=`<strong data-admin-count="${key}">—</strong><span>${label}</span>`;card.addEventListener('click',()=>showArea(card.dataset.adminJump));summary.append(card);
     }
     areas.overview.append(summary);
     const intro=document.createElement('p');intro.className='rf-sub';intro.textContent='Review users, communications, usage, system health, and rewards. Technical configuration is available separately.';areas.overview.append(intro);
     if(healthLoad){const panel=document.createElement('section');panel.className='rf-card';panel.id='systemHealthPanel';areas.health.append(panel);void loadHealth(request);}
     const setup=document.createElement('details');setup.innerHTML='<summary>Advanced configuration and downloads</summary>';setup.append(technical);areas.advanced.append(setup);
     const rewards=document.createElement('section');rewards.className='rf-card';rewards.id='adminRewardsPanel';rewards.innerHTML='<div class="rf-cardhead"><h3>Referral rewards</h3><span class="rf-pill rf-gray">Coming soon</span></div><p>Referral tracking and free-month credits are not active yet. The draft below is ready to review; it cannot be sent from this screen.</p>';areas.rewards.append(rewards);
     if(securityLoad){const panel=document.createElement('section');panel.className='rf-card';panel.id='betaSecurityPanel';areas.users.append(panel);void loadSecurity(request);}
     if(reminderLoad){const panel=document.createElement('section');panel.className='rf-card';panel.id='onboardingRemindersPanel';areas.emails.append(panel);void loadReminders(request);}
     if(planLoad){const panel=document.createElement('section');panel.className='rf-card';panel.id='adminPlansPanel';areas.usage.append(panel);void loadPlans(request);}
     if(ratesLoad){const panel=document.createElement('section');panel.className='rf-card';panel.id='adminRatesPanel';areas.usage.append(panel);void loadRates(request);}
     if(costLoad){const panel=document.createElement('section');panel.className='rf-card';panel.id='adminCostsPanel';areas.usage.append(panel);void loadCosts(request);}
     if(supportLoad){const panel=document.createElement('section');panel.className='rf-card';panel.innerHTML='<h3>Support Inbox</h3><p class="rf-sub">Private problem reports submitted from Settings.</p><button type="button" class="rf-btn" data-support-refresh>Refresh reports</button><div id="adminSupportInbox" aria-live="polite"></div>';areas.users.append(panel);void loadSupport(request);}
     const settings=getSettings();host.querySelector('#patternFunctionUrl').value=settings.url;host.querySelector('#patternAnonKey').value=settings.anonKey;
    }catch(error){
     if(request!==version)return;
     if(error?.code==='42501'||error?.code==='PGRST301')deny();
     else message('Admin tools could not be loaded. Please try again.',true);
    }finally{if(request===version)loading=null;}
   })();
   return loading;
  }
  function count(key,value){const target=host.querySelector(`[data-admin-count="${key}"]`);if(target)target.textContent=String(value);}
  function healthTime(value){return value?new Date(value).toLocaleString():'No successful run recorded';}
  async function loadHealth(request=version){
   const panel=host.querySelector('#systemHealthPanel');if(!panel)return;panel.textContent='Checking system health…';
   try{
    const snapshot=await healthLoad();if(!allowed||request!==version)return;panel.replaceChildren();
    const title=document.createElement('h3');title.textContent='System health';
    const note=document.createElement('p');note.className='rf-sub';note.textContent='Live database/auth checks plus durable operational state. AI and email health use recent real activity; this page never sends a test email or makes a paid AI call.';
    const refresh=document.createElement('button');refresh.type='button';refresh.className='rf-btn';refresh.textContent='Refresh health';
    const generated=document.createElement('p');generated.className='rf-sub';generated.textContent='Updated '+healthTime(snapshot.generated_at)+'.';
    panel.append(title,note,refresh,generated);
    const services=[['Frontend',{status:'healthy',detail:'Admin interface loaded'}],['Supabase database',snapshot.database],['Authentication',snapshot.auth],['AI processing',snapshot.ai],['Resume processing',snapshot.resume],['Email delivery',snapshot.email]];
    const grid=document.createElement('div');grid.className='rf-admin-summary';
    for(const [label,service] of services){const card=document.createElement('div');card.className='rf-admin-summary-card';const status=service?.status||'unknown';const pill=document.createElement('span');pill.className='rf-pill '+(status==='healthy'?'rf-green':status==='degraded'?'rf-red':'rf-gray');pill.textContent=status;const name=document.createElement('strong');name.textContent=label;const detail=document.createElement('span');detail.textContent=service?.detail||(service?.paused?'AI processing is paused.':service?.latest_status?('Latest email: '+service.latest_status):service?.latest_success?('Latest success: '+healthTime(service.latest_success)):'No recent activity');card.append(name,pill,detail);grid.append(card);}
    panel.append(grid);
    const assessment=document.createElement('p');assessment.className='rf-note';assessment.textContent='Latest successful candidate assessment: '+healthTime(snapshot.assessment?.latest_success)+'.';
    const monitoring=document.createElement('p');monitoring.className='rf-sub';monitoring.textContent='Last 24 hours: '+(snapshot.monitoring?.errors_24h||0)+' recorded errors · '+(snapshot.monitoring?.slow_24h||0)+' slow operations.';
    panel.append(assessment,monitoring);
    const events=snapshot.monitoring?.recent_events||[];
    const wrap=document.createElement('div');wrap.className='rf-tablewrap';const table=document.createElement('table');table.className='rf-table';table.innerHTML='<thead><tr><th>Time</th><th>Area</th><th>Operation</th><th>Status</th><th>Duration</th></tr></thead>';
    const body=document.createElement('tbody');
    for(const event of events){const row=document.createElement('tr');for(const value of [healthTime(event.created_at),event.category,event.operation,event.error_code||event.severity,event.duration_ms==null?'—':event.duration_ms+' ms']){const cell=document.createElement('td');cell.textContent=String(value||'—');row.append(cell);}body.append(row);}
    table.append(body);wrap.append(table);panel.append(wrap);if(!events.length){const empty=document.createElement('p');empty.className='rf-sub';empty.textContent='No structured reliability events have been recorded yet.';panel.append(empty);}
    if(recoveryLoad){const recovery=document.createElement('section');recovery.id='directAIRecoveryPanel';panel.append(recovery);void loadRecovery(recovery,request);}
    refresh.addEventListener('click',async()=>{refresh.disabled=true;try{await loadHealth(request);}finally{if(refresh.isConnected)refresh.disabled=false;}});
   }catch(error){if(request!==version)return;if(error.code==='42501')deny();else panel.textContent='System health could not be loaded. Reopen Admin or try again.';}
  }
  async function loadRecovery(panel,request=version){
   panel.textContent='Checking interrupted analyses…';
   try{
    const rows=await recoveryLoad();if(!allowed||request!==version||!panel.isConnected)return;panel.replaceChildren();
    const heading=document.createElement('h4');heading.textContent='Interrupted analyses';panel.append(heading);
    if(!rows?.length){const empty=document.createElement('p');empty.className='rf-sub';empty.textContent='No interrupted assessments need recovery.';panel.append(empty);return;}
    const note=document.createElement('p');note.className='rf-sub';note.textContent='Verify the request in provider logs before allowing another run. Background assessment recovery also waits at least seven minutes for the earlier worker to stop. A retry can incur another AI charge. Saved candidate data is retained.';panel.append(note);
    for(const row of rows){
     const form=document.createElement('form');form.className='rf-card';form.dataset.recoveryClaim=row.claim_id;
     const title=document.createElement('p');title.textContent=(row.kind==='intake'?'Resume intake':row.kind==='reassessment'?'Reassessment':'Direct analysis')+' · Request '+row.claim_id+' · '+healthTime(row.created_at);form.append(title);
     const state=document.createElement('p');state.className='rf-sub';state.textContent=row.provider_started_at?'Provider work may have started. Verify it is no longer running.':'Provider work was not started.';form.append(state);
     if(row.provider_call){const ref=document.createElement('p');ref.className='rf-sub';ref.textContent='Provider request: durable-'+row.claim_id+'-'+row.provider_call;form.append(ref);}
     const label=document.createElement('label'),input=document.createElement('textarea');input.required=true;input.minLength=20;input.maxLength=500;input.rows=2;input.setAttribute('aria-label','Recovery verification note');label.textContent='Verification note (20–500 characters)';label.append(input);form.append(label);
     const checkLabel=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.required=!!row.provider_started_at;check.setAttribute('aria-label','Provider request is no longer running');checkLabel.append(check,document.createTextNode(' I verified that the provider request is no longer running.'));checkLabel.hidden=!row.provider_started_at;form.append(checkLabel);
     const button=document.createElement('button');button.type='submit';button.className='rf-btn';button.textContent='Allow retry';button.disabled=true;
     const sync=()=>{button.disabled=input.value.trim().length<20||(!!row.provider_started_at&&!check.checked);};input.addEventListener('input',sync);check.addEventListener('change',sync);
     const status=document.createElement('p');status.setAttribute('role','status');form.append(button,status);
     form.addEventListener('submit',async event=>{event.preventDefault();if(!allowed||request!==version)return;button.disabled=true;try{await recoveryRetry(row.claim_id,input.value.trim(),check.checked);if(allowed&&request===version){toast(row.kind==='intake'||row.kind==='reassessment'?'Recovery verified. Saved work is queued for processing.':'Retry is available. The recruiter can run the analysis again.');await loadRecovery(panel,request);}}catch(error){if(error.code==='42501')deny();else{status.textContent=error.message||'Recovery could not be saved. Refresh health and try again.';sync();}}});panel.append(form);
    }
   }catch(error){if(request!==version)return;if(error.code==='42501')deny();else panel.textContent='Interrupted analyses could not be checked. Refresh health to retry.';}
  }
  async function loadReminders(request=version){
   const panel=host.querySelector('#onboardingRemindersPanel');if(!panel)return;panel.textContent='Loading onboarding recipients…';
   try{
    const rows=await reminderLoad();if(!allowed||request!==version)return;panel.replaceChildren();
    const title=document.createElement('h3');title.textContent='Weekly onboarding reminders';
    const note=document.createElement('p');note.className='rf-sub';note.textContent='Checking a user enables the weekly reminder. Send now sends their current onboarding email immediately, at most once per week. Users can opt out in Settings.';panel.append(title,note);
    count('emails',(rows||[]).filter(row=>row.enabled&&!row.opted_out).length);
    const status=document.createElement('p');status.setAttribute('role','status');
    const toolbar=document.createElement('div');toolbar.className='rf-admin-toolbar';
    const search=document.createElement('input');search.type='search';search.placeholder='Search users';search.setAttribute('aria-label','Search reminder users');
    const filter=document.createElement('select');filter.setAttribute('aria-label','Filter reminder users');
    for(const [value,label] of [['all','All users'],['eligible','Eligible'],['enabled','Weekly enabled'],['completed','Completed']]){const option=document.createElement('option');option.value=value;option.textContent=label;filter.append(option);}
    toolbar.append(search,filter);panel.append(toolbar);
    const wrap=document.createElement('div');wrap.className='rf-tablewrap';const table=document.createElement('table');table.className='rf-table rf-admin-reminder-table';
    const head=document.createElement('thead');const header=document.createElement('tr');for(const label of ['User','Next email','Weekly enabled','Last sent','Action']){const th=document.createElement('th');th.textContent=label;header.append(th);}head.append(header);table.append(head);
    const tbody=document.createElement('tbody');table.append(tbody);wrap.append(table);
    const empty=document.createElement('p');empty.className='rf-sub';empty.textContent='No users match this filter.';empty.hidden=true;
    const visible=[];
    const subjects={create_job:'Create your first job in blumr',add_candidate:'Add your first candidates to blumr',review_assessment:'Review your first assessment in blumr'};
    for(const row of rows||[]){const item=document.createElement('tr'),user=document.createElement('td'),step=document.createElement('td'),enabled=document.createElement('td'),last=document.createElement('td'),action=document.createElement('td'),label=document.createElement('label'),toggle=document.createElement('input');toggle.type='checkbox';toggle.checked=row.enabled;toggle.disabled=row.opted_out||!row.approved;
     user.textContent=row.email;step.textContent=row.opted_out?'Unsubscribed':row.step==='done'?'Completed onboarding':subjects[row.step]||row.step.replaceAll('_',' ');
     label.className='rf-admin-toggle';label.append(toggle,document.createTextNode(' '+(toggle.checked?'On':'Off')));enabled.append(label);
     last.textContent=row.last_sent_at?new Date(row.last_sent_at).toLocaleDateString():'Never';item.append(user,step,enabled,last,action);tbody.append(item);visible.push({row,item});
     const send=document.createElement('button');send.type='button';send.className='rf-btn';send.textContent=row.send_status==='sent'?'Sent this week':row.send_status==='claimed'?'Sending…':'Send now';
     const syncSend=()=>{send.hidden=row.opted_out||!row.approved||!subjects[row.step];send.disabled=!toggle.checked||row.send_status==='sent'||row.send_status==='claimed';send.textContent=row.send_status==='sent'?'Sent this week':row.send_status==='claimed'?'Sending…':toggle.checked?'Send now':'Enable to send';label.lastChild.textContent=' '+(toggle.checked?'On':'Off');};syncSend();action.append(send);
     toggle.addEventListener('change',async()=>{toggle.disabled=true;send.disabled=true;try{await reminderSave(row.user_id,toggle.checked);row.enabled=toggle.checked;count('emails',(rows||[]).filter(entry=>entry.enabled&&!entry.opted_out).length);status.textContent='Recipient selection saved.';}catch(error){toggle.checked=!toggle.checked;status.textContent=error.message||'Could not save selection.';}finally{toggle.disabled=row.opted_out||!row.approved;syncSend();}});
     send.addEventListener('click',async()=>{if(!window.confirm(`Send “${subjects[row.step]}” to ${row.email} now? This counts as this week's reminder.`))return;
      send.disabled=true;send.textContent='Sending…';status.textContent='Sending the reminder…';
      try{await reminderSend(row.user_id);row.send_status='sent';row.last_sent_at=new Date().toISOString();last.textContent=new Date(row.last_sent_at).toLocaleDateString();syncSend();status.textContent='Reminder sent to '+row.email+'.';}
      catch(error){status.textContent=error.message||'Reminder could not be sent.';send.textContent='Send now';syncSend();}
     });
    }
    const applyFilter=()=>{let matches=0;for(const {row,item} of visible){const eligible=!!subjects[row.step]&&!row.opted_out&&row.approved;const show=row.email.toLowerCase().includes(search.value.trim().toLowerCase())&&(filter.value==='all'||filter.value==='eligible'&&eligible||filter.value==='enabled'&&row.enabled||filter.value==='completed'&&row.step==='done');item.hidden=!show;if(show)matches++;}empty.hidden=matches>0;};search.addEventListener('input',applyFilter);filter.addEventListener('change',applyFilter);applyFilter();
    panel.append(wrap,empty,status);
    const draft=document.createElement('details');draft.className='rf-admin-draft';
    const heading=document.createElement('summary');heading.textContent='Referral email draft';
    const detail=document.createElement('p');detail.className='rf-sub';detail.textContent='Draft only. Referral tracking and free-month credits must be built before this offer can be sent.';
    const subject=document.createElement('p');subject.textContent='Subject: Share blumr with five recruiters, get a free month';
    const body=document.createElement('p');body.textContent='Know five recruiters who would benefit from blumr? Invite them to try it. When five new recruiters join through your referral link and each completes their first assessment, you’ll earn one month of blumr usage free. We’ll send you a link and the full terms when the referral program opens.';
    draft.append(heading,detail,subject,body);host.querySelector('#adminRewardsPanel')?.append(draft);
   }catch(error){if(request!==version)return;if(error.code==='42501')deny();else panel.textContent='Onboarding recipients could not be loaded.';}
  }
  async function loadSecurity(request=version){
   const panel=host.querySelector('#betaSecurityPanel');if(!panel)return;
   panel.textContent='Loading beta access and usage limits…';
   try{
    const snapshot=await securityLoad();if(!allowed||request!==version)return;panel.replaceChildren();
    const h=document.createElement('h3');h.textContent='Beta access and security';panel.append(h);
    const note=document.createElement('p');note.className='rf-sub';note.textContent='Approve an email before its owner creates an account. Approval sends no email. New accounts must verify their email. Revoking access blocks new data requests and AI processing.';panel.append(note);
    const form=document.createElement('form');form.className='rf-form';const label=document.createElement('label');label.textContent='Beta tester email';
    const input=document.createElement('input');input.type='email';input.required=true;input.maxLength=254;input.autocomplete='off';input.id='betaAccessEmail';label.htmlFor=input.id;
    const submit=document.createElement('button');submit.type='submit';submit.className='rf-btn primary';submit.textContent='Approve beta access';
    const status=document.createElement('p');status.setAttribute('role','status');
    form.append(label,input,submit,status);form.addEventListener('submit',async event=>{event.preventDefault();submit.disabled=true;try{await securityAccess(input.value.trim(),true);if(allowed&&request===version)await loadSecurity(request);}catch(error){status.textContent=error.message||'Approval could not be saved.';}finally{submit.disabled=false;}});panel.append(form);
    const list=document.createElement('ul');
    for(const account of snapshot.accounts||[]){const row=document.createElement('li'),text=document.createElement('span'),button=document.createElement('button');
     text.textContent=account.email+' · '+(account.approved?(account.registered?'Active account':'Approved to register'):'Access revoked')+' ';
     button.type='button';button.className='rf-btn';button.textContent=account.approved?'Revoke access':'Restore access';
     button.addEventListener('click',async()=>{button.disabled=true;try{await securityAccess(account.email,!account.approved);if(allowed&&request===version)await loadSecurity(request);}catch(error){status.textContent=error.message||'Access could not be updated.';}finally{button.disabled=false;}});row.append(text,button);list.append(row);}
    panel.append(list);
    count('users',(snapshot.accounts||[]).filter(account=>account.approved).length);count('usage',snapshot.today?.calls||0);
    const usage=document.createElement('p');usage.textContent=`AI calls today: ${snapshot.today?.calls||0} / ${snapshot.limits.global_day}. Per workspace: ${snapshot.limits.workspace_day} per day, ${snapshot.limits.workspace_minute} per minute. Retries count toward these limits.`;panel.append(usage);
    const pause=document.createElement('button');pause.type='button';pause.className='rf-btn';pause.textContent=snapshot.limits.ai_paused?'Resume AI processing':'Pause AI processing';
    pause.addEventListener('click',async()=>{pause.disabled=true;try{await securityPause(!snapshot.limits.ai_paused);if(allowed&&request===version)await loadSecurity(request);}catch(error){status.textContent=error.message||'Processing control could not be saved.';}finally{pause.disabled=false;}});panel.append(pause);
   }catch(error){if(request!==version)return;if(error.code==='42501')deny();else panel.textContent='Security controls could not be loaded. Reopen Admin to retry.';}
  }
  async function loadCosts(request=version){
   const panel=host.querySelector('#adminCostsPanel');if(!panel)return;panel.textContent='Loading AI cost coverage…';
   try{
    const report=await costLoad();if(!allowed||request!==version)return;panel.replaceChildren();
    const title=document.createElement('h3');title.textContent='AI cost coverage · last 30 days';panel.append(title);
    const note=document.createElement('p');note.className='rf-sub';
    note.textContent=`${report.provider_calls} provider responses recorded · ${report.unattributed_calls} without a recruiter · ${report.unpriced_calls} without a model rate. Priced responses total $${Number(report.estimated_usd_for_priced_calls).toFixed(2)}. This is a partial estimate when attribution or pricing is missing; it excludes unrecorded calls, infrastructure, and support.`;panel.append(note);
    const list=document.createElement('ul');
    for(const row of report.rows||[]){const item=document.createElement('li');
     item.textContent=`${row.workspace} · ${row.email||'Unattributed'}: ${row.provider_calls} recorded responses, ${row.completed_operations} completed product operations, $${Number(row.estimated_usd_for_priced_calls).toFixed(2)} priced cost${row.unpriced_calls?' ('+row.unpriced_calls+' unpriced)':''}.`;list.append(item);}
    panel.append(list);
   }catch(error){if(request!==version)return;if(error.code==='42501')deny();else panel.textContent='AI cost coverage could not be loaded. Reopen Admin to retry.';}
  }
  async function loadRates(request=version){
   const panel=host.querySelector('#adminRatesPanel');if(!panel)return;panel.textContent='Loading model rates…';
   try{
    const rates=await ratesLoad();if(!allowed||request!==version)return;panel.replaceChildren();
    const title=document.createElement('h3');title.textContent='Provider cost rates';panel.append(title);
    const note=document.createElement('p');note.className='rf-sub';note.textContent='Enter the current USD rate per million tokens for each model you use. Estimates apply the configured rates to recorded provider usage; they do not include taxes or other infrastructure.';panel.append(note);
    const form=document.createElement('form');form.className='rf-form';
    const model=document.createElement('input');model.required=true;model.maxLength=160;model.placeholder='Provider model ID';
    const select=document.createElement('select');const other=document.createElement('option');other.value='';other.textContent='Select a recorded model';select.append(other);
    for(const rate of rates){const option=document.createElement('option');option.value=rate.model;option.textContent=rate.model+' · '+rate.calls+' calls'+(rate.input===null?' · unpriced':'');select.append(option);}
    const field=(name)=>{const input=document.createElement('input');input.type='number';input.min='0';input.max='100000';input.step='0.000001';input.required=true;const label=document.createElement('label');label.textContent=name;label.append(input);form.append(label);return input;};
    form.append(select);const label=document.createElement('label');label.textContent='Model ID';label.append(model);form.append(label);
    const input=field('Input USD / million tokens'),cached=field('Cached input USD / million tokens'),output=field('Output USD / million tokens');
    select.addEventListener('change',()=>{const selected=rates.find(rate=>rate.model===select.value);if(!selected)return;model.value=selected.model;input.value=selected.input??'';cached.value=selected.cached??'';output.value=selected.output??'';});
    const save=document.createElement('button');save.type='submit';save.className='rf-btn primary';save.textContent='Save model rate';const status=document.createElement('p');status.setAttribute('role','status');form.append(save,status);
    form.addEventListener('submit',async event=>{event.preventDefault();save.disabled=true;status.textContent='Saving rate…';try{await ratesSave(model.value.trim(),Number(input.value),Number(cached.value),Number(output.value));if(allowed&&request===version){await loadRates(request);if(costLoad)await loadCosts(request);}}catch(error){status.textContent=error.message||'Could not save model rate.';}finally{save.disabled=false;}});
    panel.append(form);
   }catch(error){if(request!==version)return;if(error.code==='42501')deny();else panel.textContent='Model rates could not be loaded. Reopen Admin to retry.';}
  }
  async function loadPlans(request=version){
   const panel=host.querySelector('#adminPlansPanel');if(!panel)return;panel.textContent='Loading team plans…';
   try{
    const plans=await planLoad();if(!allowed||request!==version)return;panel.replaceChildren();
    const title=document.createElement('h3');title.textContent='Paid pilot access';panel.append(title);
    const note=document.createElement('p');note.className='rf-sub';note.textContent='Set pilot access after confirming payment outside blumr. This does not charge a customer.';panel.append(note);
    const form=document.createElement('form');form.className='rf-form';
    const label=(text,control)=>{const wrap=document.createElement('label');wrap.textContent=text;wrap.append(control);return wrap;};
    const team=document.createElement('select');team.required=true;
    for(const item of plans||[]){const option=document.createElement('option');option.value=item.id;option.textContent=item.name+' · '+item.owner_email+' · '+item.plan+' ('+item.status+')';team.append(option);}
    const plan=document.createElement('select');for(const value of ['beta','pilot']){const option=document.createElement('option');option.value=value;option.textContent=value==='beta'?'Beta':'Paid pilot';plan.append(option);}
    const status=document.createElement('select');for(const value of ['active','paused','expired']){const option=document.createElement('option');option.value=value;option.textContent=value;status.append(option);}
    const allowance=document.createElement('input');allowance.type='number';allowance.min='1';allowance.max='100000';allowance.value='200';
    const end=document.createElement('input');end.type='date';
    const sync=()=>{const selected=plans.find(item=>item.id===team.value);if(!selected)return;plan.value=selected.plan;status.value=selected.status;allowance.value=selected.monthly_ai_calls||200;end.value=selected.period_ends_at?.slice(0,10)||'';};team.addEventListener('change',sync);sync();
    const button=document.createElement('button');button.className='rf-btn primary';button.type='submit';button.textContent='Save plan';const feedback=document.createElement('p');feedback.setAttribute('role','status');
    form.append(label('Team ',team),label('Plan ',plan),label('Access ',status),label('AI calls per month ',allowance),label('Access end date (optional) ',end),button,feedback);
    form.addEventListener('submit',async event=>{event.preventDefault();button.disabled=true;feedback.textContent='Saving plan…';try{await planSave(team.value,plan.value,status.value,plan.value==='pilot'?Number(allowance.value):null,end.value?new Date(end.value+'T23:59:59Z').toISOString():null);if(allowed&&request===version)await loadPlans(request);}catch(error){feedback.textContent=error.message||'Could not save plan.';}finally{button.disabled=false;}});
    panel.append(form);
   }catch(error){if(request!==version)return;if(error.code==='42501')deny();else panel.textContent='Team plans could not be loaded. Reopen Admin to retry.';}
  }
  async function loadSupport(request=version){
   const inbox=host.querySelector('#adminSupportInbox');if(!inbox)return;
   try{const rows=await supportLoad();if(!allowed||request!==version)return;inbox.replaceChildren();count('support',rows.filter(row=>row.status==='open').length);
    if(!rows.length){inbox.textContent='No reports yet.';return;}
    for(const row of rows){const item=document.createElement('article');item.className='settings-details';const title=document.createElement('h4'),meta=document.createElement('p'),description=document.createElement('p'),actions=document.createElement('div');title.textContent=row.subject;meta.textContent=row.reply_email+' · '+row.status+' · '+row.id.slice(0,8);description.textContent=row.description;description.style.whiteSpace='pre-wrap';actions.className='rf-actions';
     for(const status of ['open','reviewed','resolved']){const b=document.createElement('button');b.type='button';b.className='rf-btn';b.textContent=status==='open'?'Reopen':'Mark '+status;b.disabled=row.status===status;b.addEventListener('click',async()=>{b.disabled=true;try{await supportReview(row.id,status);if(allowed&&request===version)await loadSupport(request);}catch(error){if(request!==version)return;if(error.code==='42501')deny();else toast('Report could not be updated. Try again.','error');}finally{if(b.isConnected)b.disabled=false;}});actions.append(b);}
     item.append(title,meta,description,actions);inbox.append(item);
    }
   }catch(error){if(request!==version)return;if(error.code==='42501')deny();else inbox.textContent='Reports could not be loaded. Use Refresh reports to retry.';}
  }
  async function action(event){
   const button=event.target.closest('button');if(!button||!host.contains(button)||!allowed)return;
   if(button.dataset.adminRetry){void open();return;}
   if(button.hasAttribute('data-support-refresh')){void loadSupport();return;}
   const file=files[button.id];if(!file&&button.id!=='saveHybridSettings')return;
   const request=version;button.disabled=true;
   try{
    if(file){
     const result=await download(file,host.querySelector('#backendModel').value.trim(),host.querySelector('#backendProject').value.trim());
     if(!allowed||request!==version)return;
     if(typeof result?.content!=='string'||typeof result?.name!=='string')throw Error('Download unavailable.');
     saveFile(result.content,result.name,result.type||'text/plain');
    }else{
     // Recheck the server role for every action, including a session-only override.
     const permitted=await authorize();if(!allowed||request!==version)return;
     if(permitted!==true){deny();return;}
     const settings={url:host.querySelector('#patternFunctionUrl').value.trim(),anonKey:host.querySelector('#patternAnonKey').value.trim()};
     const target=new URL(settings.url),current=new URL(getSettings().url);
     if(target.origin!==current.origin||!target.pathname.startsWith('/functions/v1/')||target.username||target.password)throw Error('Use a function URL in the configured Supabase project.');
     if(!settings.anonKey)throw Error('Enter the public Supabase key.');
     saveSettings(settings);toast('Connection updated for this session.');
    }
   }catch(error){
    if(request!==version)return;
    if(error?.code==='42501'||error?.code==='PGRST301')deny();
    else toast(error?.message||'The admin action could not be completed.','error');
   }finally{if(button.isConnected)button.disabled=false;}
  }
  host.addEventListener('click',action);
  return {open,setAllowed,clear,isAllowed:()=>allowed};
 }
 const api={create};if(typeof module==='object'&&module.exports)module.exports=api;global.AncalagonAdminTools=api;
})(globalThis);
