const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('job preview uses the same conservative code-first priorities as the backend',async()=>{
 const browser=require('../assets/job-intake-code.js'),server=await import('../supabase/functions/refine-job-criteria/code-first.mjs');
 const passages=[{id:'1',text:'Requires 5 years of .NET development experience.'},{id:'2',text:'Azure experience is preferred.'},{id:'3',text:'No Kafka experience is required.'}];
 assert.deepEqual(browser.suggestPriorities(passages),server.suggestPriorities(passages));
 assert.doesNotMatch(JSON.stringify(browser.suggestPriorities(passages).items),/Kafka/);
});
test('activation disappears after the first reviewed assessment without adding mandatory steps',()=>{
 const home=require('../assets/home.js'),host={innerHTML:''},state={jobs:[{id:'j',title:'QA'}],candidates:[{id:'c',jobId:'j',name:'Example',aiReview:{verdict:'Accurate'}}]};
 home.render(host,home.model(state,null,false));assert.doesNotMatch(host.innerHTML,/activationTitle/);
 state.candidates[0].aiReview=null;home.render(host,home.model(state,null,false));assert.match(host.innerHTML,/activationTitle/);assert.match(host.innerHTML,/Review your first assessment/);
});
test('branded auth and reminders preserve trusted links and escape content',async()=>{
 const {brandedEmail,authEmailSettings}=await import('../supabase/functions/_shared/email-template.mjs');
 const html=brandedEmail({subject:'Example',heading:'Hello <script>',body:'<img onerror=x>',button:'Open',url:'https://blumr.io/',footer:'Preferences'});
 assert.match(html,/lang="en" dir="ltr"/);assert.match(html,/role="presentation"/);assert.match(html,/alt="blumr"/);assert.doesNotMatch(html,/<script>|<img onerror/);
 assert.throws(()=>brandedEmail({url:'javascript:alert(1)'}));
 const settings=authEmailSettings();assert.match(settings.mailer_templates_recovery_content,/\{\{ .ConfirmationURL \}\}/);
 assert.match(settings.mailer_subjects_confirmation,/blumr/);assert.equal(Object.keys(settings).length,8);
});
