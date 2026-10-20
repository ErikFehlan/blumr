(function(global){
 'use strict';
 const MAX_FILE=10*1024*1024,MAX_TOTAL=1024*1024*1024,MAX_ZIP=200*1024*1024;
 const supported=/\.(pdf|docx|doc|txt)$/i;
 function inspectZip(bytes){
  if(bytes.length>MAX_ZIP||bytes.length<22)throw Error('Choose a ZIP up to 200 MB.');
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),decode=(p,n)=>new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(p,p+n));let end=-1;
  for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(v.getUint32(p,true)===0x06054b50&&p+22+v.getUint16(p+20,true)===bytes.length){end=p;break;}
  if(end<0||v.getUint16(end+4,true)||v.getUint16(end+6,true)||v.getUint16(end+8,true)!==v.getUint16(end+10,true))throw Error('Split or damaged ZIP archives are unsupported.');
  const count=v.getUint16(end+10,true),size=v.getUint32(end+12,true),offset=v.getUint32(end+16,true),entries=[],seen=new Set();let p=offset,total=0;
  if(!count||count>2000||offset+size!==end)throw Error('ZIP64 or unusually large archives are unsupported.');
  for(let n=0;n<count;n++){
   if(p+46>end||v.getUint32(p,true)!==0x02014b50)throw Error('Damaged ZIP directory.');
   const flags=v.getUint16(p+8,true),method=v.getUint16(p+10,true),crc=v.getUint32(p+16,true),packed=v.getUint32(p+20,true),expanded=v.getUint32(p+24,true),len=v.getUint16(p+28,true),extra=v.getUint16(p+30,true),comment=v.getUint16(p+32,true),local=v.getUint32(p+42,true);
   if(p+46+len+extra+comment>end||local+30>offset||v.getUint32(local,true)!==0x04034b50)throw Error('Damaged ZIP entry.');
   const name=decode(p+46,len),localLen=v.getUint16(local+26,true),localExtra=v.getUint16(local+28,true);
   if(local+30+localLen+localExtra+packed>offset||decode(local+30,localLen)!==name||v.getUint16(local+8,true)!==method||v.getUint16(local+6,true)!==flags)throw Error('ZIP entry metadata does not match.');
   if(flags&1||![0,8].includes(method)||packed===0xffffffff||expanded>MAX_FILE||/^\/|\\|(^|\/)\.\.?($|\/)|^[a-z]:/i.test(name)||name.includes('\0')||seen.has(name))throw Error('Encrypted, unsafe, duplicate, or oversized ZIP entries are unsupported.');
   seen.add(name);p+=46+len+extra+comment;
   if(name.endsWith('/')||name.startsWith('__MACOSX/')||/(^|\/)\.DS_Store$/.test(name))continue;
   if(!supported.test(name)||!expanded)throw Error('The ZIP must contain only readable PDF, DOC, DOCX, or TXT resumes. Remove other files and retry.');
   total+=expanded;if(total>MAX_TOTAL||entries.length>=1000||name.length>240)throw Error('Choose up to 1,000 resumes and 1 GB of expanded files.');
   entries.push({name,size:expanded,crc});
  }
  if(p!==end||!entries.length)throw Error('No supported resumes found.');
  return entries;
 }
 const crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
 function inflate(entry,meta){return new Promise((resolve,reject)=>{
  let size=0,crc=0xffffffff,failed=false;const chunks=[],stream=entry.internalStream('uint8array');
  stream.on('data',chunk=>{if(failed)return;size+=chunk.length;if(size>meta.size||size>MAX_FILE){failed=true;stream.pause();reject(Error('ZIP expanded beyond its declared size.'));return;}
   for(const byte of chunk)crc=crcTable[(crc^byte)&255]^(crc>>>8);chunks.push(chunk);
  }).on('error',reject).on('end',()=>{if(failed)return;if(size!==meta.size||((crc^0xffffffff)>>>0)!==meta.crc){reject(Error('ZIP resume failed its integrity check.'));return;}
   const name=meta.name.split('/').pop(),extension=name.split('.').pop().toLowerCase();
   const type={pdf:'application/pdf',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',txt:'text/plain'}[extension];
   resolve(new File(chunks,name,{type}));}).resume();
 });}
 async function expand(files,{zip=global.JSZip}={}){
  const entries=[];let bytes=0;
  for(const file of Array.from(files||[])){
   if(/\.zip$/i.test(file.name)){
    if(!zip)throw Error('ZIP support did not load. Refresh and try again.');
    if(file.size>MAX_ZIP)throw Error('Choose a ZIP up to 200 MB.');
    const data=new Uint8Array(await file.arrayBuffer()),manifest=inspectZip(data),archive=await zip.loadAsync(data);
    for(const item of manifest){const entry=archive.file(item.name);if(!entry||entry.unsafeOriginalName&&entry.unsafeOriginalName!==item.name)throw Error('Unsafe ZIP filename.');entries.push({...item,load:()=>inflate(entry,item)});bytes+=item.size;}
   }else{
    if(!supported.test(file.name)||!file.size||file.size>MAX_FILE||file.name.length>240)throw Error('Choose readable PDF, DOC, DOCX, or TXT files up to 10 MB.');
    entries.push({name:file.name,size:file.size,load:async()=>file});bytes+=file.size;
   }
   if(entries.length>1000||bytes>MAX_TOTAL)throw Error('Choose up to 1,000 resumes and 1 GB per batch.');
  }
  if(!entries.length)throw Error('Choose at least one resume.');return entries;
 }
 const api={inspectZip,expand,inflate};if(typeof module!=='undefined')module.exports=api;global.BlumrBulkFiles=api;
})(typeof window==='undefined'?globalThis:window);
