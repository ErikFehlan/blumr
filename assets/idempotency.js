(function(global){
  'use strict';

  function canonical(value){
    if(value===null)return 'null';
    if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
    if(typeof value==='object'){
      return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
    }
    const encoded=JSON.stringify(value);
    return encoded===undefined?String(value):encoded;
  }

  function createCoalescer(){
    const inflight=new Map();
    return {
      run(keyValue,operation){
        const key=typeof keyValue==='string'?keyValue:canonical(keyValue);
        if(inflight.has(key))return inflight.get(key);
        let promise;
        try{promise=Promise.resolve(operation());}
        catch(error){promise=Promise.reject(error);}
        inflight.set(key,promise);
        const clear=()=>{if(inflight.get(key)===promise)inflight.delete(key);};
        promise.then(clear,clear);
        return promise;
      },
      has(keyValue){return inflight.has(typeof keyValue==='string'?keyValue:canonical(keyValue));},
      size(){return inflight.size;}
    };
  }

  const api={canonical,createCoalescer};
  if(typeof module!=='undefined')module.exports=api;
  global.BlumrIdempotency=api;
})(typeof window!=='undefined'?window:globalThis);
