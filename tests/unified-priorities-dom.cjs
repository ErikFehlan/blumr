const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{webcrypto}=require('node:crypto');
const {parseHTML}=require('linkedom');
function setup(generator){
 const {window}=parseHTML(fs.readFileSync('index.html','utf8')),storage=new Map();
 for(const el of window.document.querySelectorAll('input,textarea'))el.value='';
 const ctx=vm.createContext({window,globalThis:window,document:window.document,setTimeout,clearTimeout,sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}});
 for(const file of ['job-intake-code','hiring-priorities','job-wizard'])vm.runInContext(fs.readFileSync('assets/'+file+'.js','utf8'),ctx);
 const root=window.document.querySelector('#rf-app'),api=window.BlumrJobWizard.create(root,{priorities:generator});api.scope('workspace:user');api.start();
 return {window,api,root,q:id=>root.querySelector('#'+id)};
}
(async()=>{
 let calls=0;const items=[{id:'priority-1',title:'Design Azure landing zones',reason:'Build the migration foundation.',question:'What landing zones did you implement?',requirement_type:'inferred',source_quote:'Design Azure landing zones.'},{id:'priority-2',title:'Migrate on-premises workloads',reason:'Move existing services to the cloud.',question:'What did you migrate?',requirement_type:'inferred',source_quote:'Migrate on-premises workloads.'}];
 const t=setup(async input=>{calls++;return {draft_id:'draft-'+calls,input,items};});
 t.q('jobTitle').value='Azure Engineer';t.q('jobDescription').value='Design Azure landing zones. Migrate on-premises workloads.';t.q('jobCriteria').value='Preferred | Azure certification';
 const first=await t.api.ensure();assert.equal(calls,1);assert.equal(first.items[0].title,items[0].title);
 assert.equal(t.q('jobCriteria').value,'Preferred | Azure certification','priorities must not become screening criteria');
 await t.api.ensure();assert.equal(calls,1);
 t.root.querySelector('[data-customize-priorities]').click();t.root.querySelector('[data-priority-move="1"][data-direction="-1"]').click();
 const edited=t.root.querySelector('[name=title]');edited.value='Migrate production services safely';edited.dispatchEvent(new t.window.Event('input'));
 const chosen=await t.api.ensure();assert.equal(chosen.items[0].id,'priority-2');assert.equal(chosen.items[0].title,'Migrate production services safely');assert.equal(calls,1);
 t.api.keep();t.api.reset();t.api.start();const restored=await t.api.ensure();assert.equal(restored.items[0].title,'Migrate production services safely');assert.equal(calls,1);
 t.q('jobDescription').value='Operate the existing cloud platform.';await t.api.ensure();assert.equal(calls,2);
 let release;const stale=setup(()=>new Promise(r=>release=r));stale.q('jobTitle').value='QA';stale.q('jobDescription').value='Manual regression testing.';const pending=stale.api.ensure();await Promise.resolve();stale.api.scope('other');release({draft_id:'stale',items});await assert.rejects(pending,/changed/);assert.ok(!stale.q('jobPriorityDraft').textContent.includes(items[0].title));
 const fail=setup(async()=>{throw Error('AI unavailable');});fail.q('jobTitle').value='QA';fail.q('jobDescription').value='Manual regression testing.';await assert.rejects(fail.api.ensure(),/AI unavailable/);assert.ok(!fail.q('jobPriorityDraft').textContent.includes('Hands-on'));fail.root.querySelector('[data-defer-priorities]').click();assert.equal(await fail.api.ensure(),null);
 console.log('PASS unified priorities: same list, no criteria duplication, cache, reorder/edit, draft restore, context changes, account isolation, recoverable failure');
})().catch(e=>{console.error(e);process.exitCode=1;});
