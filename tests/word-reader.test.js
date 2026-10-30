const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {createExtractor}=require('../assets/resume-word-text.js');
const file={size:8,arrayBuffer:async()=>new ArrayBuffer(8)};
function workerClass(run){
  return class Worker{
    static instances=[];
    constructor(url){this.url=url;this.stopped=false;this.constructor.instances.push(this);}
    postMessage(message,transfer){this.message=message;this.transfer=transfer;run?.(this);}
    terminate(){this.stopped=true;}
  };
}
test('Word extraction sends only bytes and terminates on success without interpreting markup',async()=>{
  const Worker=workerClass(w=>queueMicrotask(()=>w.onmessage({data:{ok:true,text:'<img src=x onerror=alert(1)>\nQA Analyst'}})));
  assert.equal(await createExtractor({WorkerClass:Worker})(file),'<img src=x onerror=alert(1)>\nQA Analyst');
  const w=Worker.instances[0];assert.deepEqual(Object.keys(w.message),['bytes']);assert.equal(w.transfer[0],w.message.bytes);assert.ok(w.stopped);
});
test('a stalled Word parser is terminated and a late result cannot complete the request',async()=>{
  const Worker=workerClass();let timeout;
  const result=createExtractor({WorkerClass:Worker,schedule:fn=>(timeout=fn,1),cancel:()=>{}})(file);
  await Promise.resolve();const w=Worker.instances[0],late=w.onmessage;timeout();
  await assert.rejects(result,/too long/);assert.ok(w.stopped);late({data:{ok:true,text:'late'}});assert.equal(w.onmessage,null);
});
test('malformed, oversized and crashed parser results fail closed and release their worker',async()=>{
  for(const data of [null,{ok:false},{ok:true,text:42},{ok:true,text:'x'.repeat(800001)}]){
    const Worker=workerClass(w=>queueMicrotask(()=>w.onmessage({data})));
    await assert.rejects(createExtractor({WorkerClass:Worker})(file));assert.ok(Worker.instances[0].stopped);
  }
  const Worker=workerClass(w=>queueMicrotask(()=>w.onerror({preventDefault(){}})));
  await assert.rejects(createExtractor({WorkerClass:Worker})(file));assert.ok(Worker.instances[0].stopped);
});
test('oversized or inconsistent inputs never start a parser',async()=>{
  const Worker=workerClass(),extract=createExtractor({WorkerClass:Worker});
  await assert.rejects(extract({...file,size:10485761}));await assert.rejects(extract({...file,size:9}));assert.equal(Worker.instances.length,0);
});
test('the reviewed vendored parser checksum is pinned',()=>{
  const bundle=fs.readFileSync(require.resolve('../assets/vendor/mammoth-1.13.0.min.js'));
  assert.equal(crypto.createHash('sha256').update(bundle).digest('hex'),'92914a3708cfdf1e62cb553d1856a7fedab21da83d8ee82845de2f897b368cab');
});
