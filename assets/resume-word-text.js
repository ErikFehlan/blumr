(function(global){
  'use strict';
  const MAX_FILE=10*1024*1024,MAX_TEXT=800000;
  function createExtractor({WorkerClass,timeoutMs=15000,schedule=setTimeout,cancel=clearTimeout}={}){
    return async function extract(file){
      if(!file||!file.size||file.size>MAX_FILE)throw Error('Choose a Word resume up to 10 MB.');
      const bytes=await file.arrayBuffer();
      if(!(bytes instanceof ArrayBuffer)||bytes.byteLength!==file.size)throw Error('The Word document could not be read.');
      return new Promise((resolve,reject)=>{
        let worker,timer,finished=false;
        function finish(error,text){
          if(finished)return;finished=true;cancel(timer);
          if(worker){worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;worker.terminate();}
          if(error)reject(error);else resolve(text);
        }
        try{
          // A fresh worker receives only document bytes, never session credentials.
          worker=new (WorkerClass||global.Worker)('assets/resume-word-worker.js?v=20261030-1.13.0');
          timer=schedule(()=>finish(Error('This Word document took too long to read. Export it as a PDF or plain text and try again.')),timeoutMs);
          worker.onmessage=event=>{
            const result=event.data;
            if(result?.ok!==true||typeof result.text!=='string'||result.text.length>MAX_TEXT){finish(Error('This Word document could not be read safely. Export it as a PDF or plain text and try again.'));return;}
            finish(null,result.text);
          };
          worker.onerror=event=>{event.preventDefault?.();finish(Error('The Word reader could not finish. Export the resume as a PDF or try again.'));};
          worker.onmessageerror=()=>finish(Error('The Word reader returned an unreadable result.'));
          worker.postMessage({bytes},[bytes]);
        }catch{finish(Error('The Word reader could not start. Refresh the page or upload a PDF.'));}
      });
    };
  }
  const api={extract:createExtractor()};
  if(typeof module!=='undefined')module.exports={...api,createExtractor};
  global.BlumrWordText=api;
})(typeof window==='undefined'?globalThis:window);
