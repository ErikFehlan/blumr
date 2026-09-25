const {test}=require('node:test');
const assert=require('node:assert/strict');
const recruiter=require('../assets/recruiter-workflow.js');
const remote=require('../assets/resume-remote.js');
const intake=require('../assets/resume-intake.js');
const context=require('../assets/context.js');
const profile='Morgan Vale | Senior Software Engineer\nOwned manual regression testing for billing systems and documented defects.\nBuilt C# services and reviewed SQL queries.\n';
const source=name=>name==='tiny.txt'?'Hi.\n':name==='Morgan Vale.txt'?profile+'Project: invoicing.\n':name==='Morgan Vále.txt'?profile+'Project: observability.\n':name.startsWith('batch-')?profile+'Unique synthetic project reference '+name.slice(6,8)+'.\n':profile;
const file=name=>({name,size:Buffer.byteLength(source(name))});
async function settled(batch){const until=Date.now()+20000;while(Date.now()<until){if(!batch.view().some(i=>['waiting','reading','saving'].includes(i.state)))return;await new Promise(r=>setTimeout(r,5));}throw Error('Upload queue stalled');}

test('50 files in allowed batches, with a duplicate and a failed file, never block subsequent uploads',async()=>{
 const job={id:'job',title:'Software Engineer',status:'active'},candidates=[],documents=new Map(),requests=[];let fail=true;
 const flow=intake.create({job:()=>job,workspace:()=> 'workspace',candidates:()=>candidates,
  extract:async f=>source(f.name),add:c=>{c.short=c.name;candidates.push(c);return c},
  persist:async()=>{},upload:async(c,f,text)=>{if(f.name==='batch-25.txt'&&fail){fail=false;throw Error('Simulated network failure')}documents.set(c.id,text)},
  text:async c=>documents.get(c.id)||'',requestRemote:async id=>requests.push(id),loadRemoteBatch:async()=>[],
  context:()=>({}),signature:()=>'',changed:()=>{},toast:()=>{},open:()=>{}});
 const batch=recruiter.createBatch({job:()=>job,workspace:()=> 'workspace',upload:(f,o)=>flow.upload(f,o),release:id=>flow.releaseFile(id),toast:()=>{}});
 assert.equal(batch.add(Array.from({length:50},(_,n)=>file(`batch-${String(n+1).padStart(2,'0')}.txt`))),false);
 for(const [start,end] of [[1,20],[21,40],[41,50]]){
  assert.equal(batch.add(Array.from({length:end-start+1},(_,n)=>file(`batch-${String(start+n).padStart(2,'0')}.txt`))),true);
  await settled(batch);
 }
 assert.equal(batch.view().filter(i=>i.state==='error').length,1);
 const failed=batch.view().find(i=>i.state==='error');batch.retry(failed.id);await settled(batch);
 assert.equal(batch.view().filter(i=>i.state==='saved').length,50);
 assert.equal(candidates.length,50);assert.equal(documents.size,50);
 batch.add([file('batch-01.txt')]);await settled(batch);
 assert.equal(candidates.length,50);assert.equal(batch.view().at(-1).duplicate,true);
 assert.equal(new Set(requests).size,50);
 flow.dispose?.();
});

test('tiny and over-limit resumes fail before candidate creation; same name with different content remains distinct',async()=>{
 const candidates=[],job={id:'j',status:'active'},messages=[];
 const flow=intake.create({job:()=>job,workspace:()=> 'w',candidates:()=>candidates,
  extract:async f=>f.name==='100-page-over-limit.pdf'?'a'.repeat(120001):source(f.name),
  add:c=>{c.short=c.name;candidates.push(c);return c},persist:async()=>{},upload:async()=>{},requestRemote:async()=>{},
  context:()=>({}),signature:()=>'',changed:()=>{},toast:m=>messages.push(m),open:()=>{}});
 await assert.rejects(()=>flow.upload(file('tiny.txt'),{silent:true}),/No usable resume text/);
 await assert.rejects(()=>flow.upload(file('100-page-over-limit.pdf'),{silent:true}),/too long/);
 assert.equal(candidates.length,0);
 const a=await flow.upload(file('Morgan Vale.txt'),{silent:true});
 const b=await flow.upload(file('Morgan Vále.txt'),{silent:true});
 assert.notEqual(a.id,b.id);assert.equal(candidates.length,2);
 flow.dispose?.();
});

test('HTML-looking filenames remain text in the upload panel',()=>{
 const host={dataset:{},hidden:false,contains:()=>false};
 recruiter.renderBatch(host,[{id:'1',state:'saved',fileName:'<svg onload=alert(1)>.txt',candidateId:'c',jobId:'j'}],'j',[{id:'c',resumeIntake:{phase:'ready'}}]);
 assert.match(host.innerHTML,/&lt;svg onload=alert\(1\)&gt;/);
 assert.doesNotMatch(host.innerHTML,/<svg/);
});

test('50 simultaneous pending assessments use one status read and preserve each candidate state',async()=>{
 const candidates=Array.from({length:50},(_,i)=>({id:`candidate-${i}`,jobId:'j',resumeIntake:{phase:'queued'}}));
 let reads=0,saves=0,refreshes=0;
 const flow=remote.create({valid:()=>true,candidates:()=>candidates,loadRemoteBatch:async ids=>{
  reads++;assert.equal(ids.length,50);
  return ids.map(id=>({candidate_id:id,job_id:'j',revision:'r1',status:'processing'}));
 },persist:async()=>saves++,changedMany:changed=>{assert.equal(changed.length,50);refreshes++},toast:()=>{}});
 try{await flow.poll();assert.ok(candidates.every(c=>c.resumeIntake.phase==='processing'));
  await flow.poll();assert.deepEqual([reads,saves,refreshes],[2,1,1]);}finally{flow.dispose();}
});

test('short and extreme job descriptions retain their exact original source in assessment context',()=>{
 for(const description of ['Software engineer',('Senior software engineer. C#, SQL, Azure, React. '.repeat(3000)).trim()]){
  const result=context.build({id:'j',title:'Software Engineer',description,criteria:[],knockouts:[]},null,[],[]);
  assert.equal(result.sources.find(source=>source.id==='job-description').text,description);
 }
});
