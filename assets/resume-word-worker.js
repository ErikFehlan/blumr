'use strict';
// The response CSP blocks network connections. No HTML or credentials cross
// this boundary, and the parent terminates the worker after one result/timeout.
importScripts('upload-validation.js?v=20261005-upload-guards','vendor/mammoth-1.13.0.min.js');
let started=false;
self.onmessage=async event=>{
  if(started)return;started=true;
  try{
    const bytes=event.data?.bytes;
    if(!(bytes instanceof ArrayBuffer))throw Error('Invalid document');
    self.AncalagonUploadGuard.inspect(new Uint8Array(bytes),'docx');
    const result=await mammoth.extractRawText({arrayBuffer:bytes},{externalFileAccess:false});
    if(typeof result.value!=='string'||result.value.length>800000)throw Error('Document exceeds text limit');
    self.postMessage({ok:true,text:result.value});
  }catch{self.postMessage({ok:false});}
  finally{self.close();}
};
