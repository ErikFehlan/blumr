// Test-harness backpressure only; never retries a quota/authorization rejection,
// ambiguous network write, or duplicate upload. No upsert and no quota changes.
export async function fixtureStorageRequest(send,{sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now,maxAttempts=3,onRetry=()=>{}}={}){
 let waited=0;
 for(let attempt=1;;attempt++){
  const response=await send();
  const text=await response.text();
  let data;try{data=JSON.parse(text);}catch{data=null;}
  const message=[data?.message,data?.error,data?.code].filter(v=>typeof v==='string').join(' ');
  const quota=/quota|budget|limit exceeded|too many (?:files|objects|resumes)|storage.*(?:full|limit)/i.test(message);
  const pressure=/max_client_conn|no more connections|database error.*08P01/i.test(message);
  const raw=response.headers.get('retry-after');
  const retryAfter=raw===null?null:/^\d+$/.test(raw)?Number(raw)*1000:Date.parse(raw)-now();
  const retryable=!quota&&([429,500,503].includes(response.status))&&(pressure||Number.isFinite(retryAfter)&&retryAfter>=0);
  const wait=Math.max(2000*2**(attempt-1),retryAfter??0);
  if(response.ok||!retryable||attempt>=maxAttempts||!Number.isFinite(wait)||waited+wait>45000)return {ok:response.ok,status:response.status,data,diagnostic:quota?'quota':pressure?'database_connection_pressure':'http_'+response.status,attempts:attempt};
  onRetry({attempt,status:response.status,delay_ms:wait,cause:pressure?'database_connection_pressure':'retry_after'});
  await sleep(wait);waited+=wait;
 }
}
