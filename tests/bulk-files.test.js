const test=require('node:test'),assert=require('node:assert/strict');
const Zip=require('../assets/vendor/jszip-3.10.1.min.js');
const {inspectZip,expand}=require('../assets/bulk-files.js');
async function archive(entries){const zip=new Zip();for(const [name,text] of entries)zip.file(name,text);return new Uint8Array(await zip.generateAsync({type:'uint8array',compression:'DEFLATE'}));}
test('ZIP resumes expand lazily with original content, names, and integrity checks',async()=>{
 const text='Synthetic applicant. Owned manual regression testing and documented defects.';
 const bytes=await archive([['applications/one.txt',text],['two.txt',text]]),files=await expand([new File([bytes],'Applications.zip')],{zip:Zip});
 assert.equal(files.length,2);assert.equal(await (await files[0].load()).text(),text);assert.equal(files[0].name,'applications/one.txt');assert.equal((await files[0].load()).name,'one.txt','Storage metadata uses a safe basename');
});
test('ZIP guard rejects traversal, unsupported exports, forged expansion, encryption and damaged directories',async()=>{
 for(const name of ['../escape.txt','/absolute.txt','nested/../../escape.txt','export.exe']){const bytes=await archive([[name,'Unsafe resume entry']]);assert.throws(()=>inspectZip(bytes));}
 const bytes=await archive([['safe.txt','Synthetic applicant evidence '.repeat(10)]]);
 for(const mutate of [b=>{b[b.length-22]=0;},b=>{const p=b.findIndex((_,i)=>b[i]===0x50&&b[i+1]===0x4b&&b[i+2]===1&&b[i+3]===2);new DataView(b.buffer).setUint32(p+24,11*1024*1024,true);},b=>{b[6]|=1;}]){const bad=bytes.slice();mutate(bad);assert.throws(()=>inspectZip(bad));}
 const unsupported=await archive([['bad.exe','not a resume']]);assert.throws(()=>inspectZip(unsupported));
});
test('manifest limits cover 20, 100, 500 and 1000 files without inflating every file',async()=>{
 for(const count of [20,100,500,1000]){const bytes=await archive(Array.from({length:count},(_,i)=>[`${i}.txt`,'Owned manual testing for billing systems.']));const files=await expand([new File([bytes],'batch.zip')],{zip:Zip});assert.equal(files.length,count);}
 const files=Array.from({length:1001},(_,i)=>new File(['resume'],i+'.txt'));await assert.rejects(()=>expand(files,{zip:Zip}),/1,000/);
});
test('corrupt compressed content fails before saving a resume',async()=>{
 const bytes=await archive([['safe.txt','Synthetic applicant evidence '.repeat(10)]]);const data=bytes.slice();data[38]^=32;
 try{const files=await expand([new File([data],'bad.zip')],{zip:Zip});await assert.rejects(()=>files[0].load());}catch(e){assert.ok(e instanceof Error);}
});
