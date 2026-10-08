const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {parseHTML}=require('linkedom');
const markup=fs.readFileSync('index.html','utf8');
function setup(options={}){
 const {window}=parseHTML(markup),storage=new Map();
 // linkedom intentionally lacks browser form values and reset methods.
 for(const element of window.document.querySelectorAll('input,textarea'))element.value='';
 const context=vm.createContext({window,globalThis:window,document:window.document,setTimeout,clearTimeout,sessionStorage:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k),removeItem:k=>storage.delete(k)}});
 vm.runInContext(fs.readFileSync('assets/job-intake-code.js','utf8'),context);
 vm.runInContext(fs.readFileSync('assets/job-wizard.js','utf8'),context);
 const root=window.document.getElementById('rf-app'),api=window.BlumrJobWizard.create(root,options),q=id=>root.querySelector('#'+id);
 return {window,root,api,q,storage};
}
(async()=>{
 const t=setup();t.api.scope('workspace-a:user-a');t.api.start();
 assert.equal(t.q('jobForm').dataset.quickStart,'true');assert.equal(t.q('jobForm').querySelector('[type=submit]').hidden,false);
 t.q('jobDescription').value='Job title: Operations Coordinator\nVendor coordination experience is required. Customer support is preferred.';
 t.q('jobDescription').dispatchEvent(new t.window.Event('input',{bubbles:true}));assert.equal(t.q('jobTitle').value,'Operations Coordinator');
 t.q('jobTitle').value='My edited title';t.q('jobDescription').dispatchEvent(new t.window.Event('input',{bubbles:true}));assert.equal(t.q('jobTitle').value,'My edited title');
 t.q('quickResumes').files=[{name:'Alex.txt',size:100}];t.q('quickResumes').dispatchEvent(new t.window.Event('change'));assert.equal(t.api.files().length,1);
 t.q('quickResumes').files=Array.from({length:20},()=>({name:'extra.txt',size:100}));t.q('quickResumes').dispatchEvent(new t.window.Event('change'));assert.equal(t.api.files().length,1);
 t.api.keep();t.api.reset();for(const id of ['jobTitle','jobDescription'])t.q(id).value='';t.api.start();assert.equal(t.q('jobTitle').value,'My edited title');assert.match(t.q('jobSaveStatus').textContent,/Select the resumes again/);
 t.api.scope('workspace-b:user-b');for(const id of ['jobTitle','jobDescription'])t.q(id).value='';t.api.start();assert.equal(t.q('jobDescription').value,'');assert.equal(t.api.files().length,0);
 t.api.scope('workspace-a:user-a');t.api.start();t.api.saved();assert.equal(t.storage.size,0);
 let release;const r=setup({extract:()=>new Promise(resolve=>release=resolve)});r.api.scope('one');r.api.start();r.q('quickJobFile').files=[{name:'job.txt',size:100}];r.q('quickJobFile').dispatchEvent(new r.window.Event('change'));
 assert.equal(r.q('jobForm').querySelector('[type=submit]').disabled,true);r.api.scope('two');r.q('jobDescription').value='';release('Job title: Wrong account');await new Promise(resolve=>setImmediate(resolve));assert.equal(r.q('jobDescription').value,'');
 const f=setup({extract:async()=>({text:'Job title: Warehouse Associate\nInventory handling experience is required.'})});f.api.scope('three');f.api.start();f.q('quickJobFile').files=[{name:'job.pdf',size:100}];f.q('quickJobFile').dispatchEvent(new f.window.Event('change'));await new Promise(resolve=>setImmediate(resolve));assert.equal(f.q('jobTitle').value,'Warehouse Associate');
 f.root.querySelector('[data-job-mode]').click();assert.equal(f.q('jobForm').dataset.quickStart,'false');assert.equal(f.q('jobForm').querySelector('[type=submit]').hidden,true);assert.equal(f.root.querySelector('[data-job-step="2"]').parentElement,f.q('jobForm'));
 console.log('PASS quick start: title extraction, editable title, batch limits, draft restore/isolation, stale file reads, PDF text results and detailed setup');
})().catch(error=>{console.error(error);process.exitCode=1;});
