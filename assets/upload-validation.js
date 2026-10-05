(function(global){
 'use strict';
 const MAX_FILE=10*1024*1024,MAX_EXPANDED=50*1024*1024;
 function inspect(bytes,extension){
  if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>MAX_FILE)throw Error('Choose a resume up to 10 MB.');
  const text=(start,end)=>new TextDecoder().decode(bytes.subarray(start,end));
  if(extension==='pdf'){
   if(!/^%PDF-\d\.\d/.test(text(0,16))||!text(Math.max(0,bytes.length-2048),bytes.length).includes('%%EOF'))throw Error('This PDF is incomplete or its file type does not match. Export a fresh PDF and try again.');
  }else if(extension==='doc'){
   if(![0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1].every((v,i)=>bytes[i]===v))throw Error('This file is not a readable legacy Word document. Save it as DOCX or PDF and try again.');
  }else if(extension==='docx'){
   const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
   for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(view.getUint32(p,true)===0x06054b50){end=p;break;}
   if(end<0||view.getUint16(end+4,true)!==0||view.getUint16(end+6,true)!==0)throw Error('This Word document is incomplete. Save a fresh DOCX and try again.');
   const count=view.getUint16(end+10,true),size=view.getUint32(end+12,true),offset=view.getUint32(end+16,true);
   if(!count||count>2000||offset+size>end)throw Error('This Word document exceeds the safe processing limit. Export it as a PDF.');
   let p=offset,total=0,document=false,types=false;
   for(let n=0;n<count;n++){
    if(p+46>end||view.getUint32(p,true)!==0x02014b50)throw Error('The Word document archive is damaged.');
    const flags=view.getUint16(p+8,true),expanded=view.getUint32(p+24,true),nameLength=view.getUint16(p+28,true),extra=view.getUint16(p+30,true),comment=view.getUint16(p+32,true);
    if(p+46+nameLength+extra+comment>offset+size)throw Error('The Word document archive is damaged.');
    const name=text(p+46,p+46+nameLength);total+=expanded;
    if(flags&1||total>MAX_EXPANDED||expanded===0xffffffff||/(^\/|\\|(^|\/)\.\.\/|vbaProject\.bin$)/i.test(name))throw Error('Encrypted, macro-enabled, or unusually large Word documents cannot be processed. Export a PDF.');
    document||=name==='word/document.xml';types||=name==='[Content_Types].xml';p+=46+nameLength+extra+comment;
   }
   if(!document||!types||p!==offset+size)throw Error('This archive is not a valid DOCX resume.');
  }else if(extension==='txt'){
   if(bytes.includes(0))throw Error('This text file contains binary content. Export the resume as UTF-8 text or PDF.');
   try{new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error('Save this text resume using UTF-8 encoding and try again.');}
  }else throw Error('Choose a PDF, DOC, DOCX, or TXT resume.');
  return true;
 }
 async function validate(file){
  if(!file||!file.size||file.size>MAX_FILE)throw Error('Choose a resume up to 10 MB.');
  return inspect(new Uint8Array(await file.arrayBuffer()),String(file.name||'').split('.').pop().toLowerCase());
 }
 const api={inspect,validate};if(typeof module!=='undefined')module.exports=api;global.AncalagonUploadGuard=api;
})(typeof window==='undefined'?globalThis:window);
