type Fetcher=(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>;
type RetryOptions={
  maxRetries?:number;
  timeoutMs?:number;
  fetcher?:Fetcher;
  wait?:(ms:number)=>Promise<void>;
  requestId?:string;
};

const retryableStatus=(status:number)=>status===408||status===409||status===429||status>=500;

function retryDelay(response:Response|undefined,attempt:number){
  const retryAfterMs=response?.headers.get('retry-after-ms');
  if(retryAfterMs){
    const value=Number(retryAfterMs);
    if(Number.isFinite(value)&&value>=0&&value<=60000)return value;
  }
  const retryAfter=response?.headers.get('retry-after');
  if(retryAfter){
    const seconds=Number(retryAfter);
    const value=Number.isFinite(seconds)?seconds*1000:Date.parse(retryAfter)-Date.now();
    if(Number.isFinite(value)&&value>=0&&value<=60000)return value;
  }
  return Math.min(250*(2**attempt),2000);
}

export async function fetchWithRetry(input:RequestInfo|URL,init:RequestInit={},options:RetryOptions={}){
  const maxRetries=Math.max(0,Math.min(4,options.maxRetries??2));
  const fetcher=options.fetcher??fetch;
  const wait=options.wait??((ms:number)=>new Promise(resolve=>setTimeout(resolve,ms)));
  let lastError:unknown;
  for(let attempt=0;attempt<=maxRetries;attempt++){
    const headers=new Headers(init.headers);
    if(options.requestId)headers.set('X-Client-Request-Id',`${options.requestId}-${attempt+1}`);
    const requestInit={...init,headers,signal:options.timeoutMs?AbortSignal.timeout(options.timeoutMs):init.signal};
    try{
      const response=await fetcher(input,requestInit);
      const explicit=response.headers.get('x-should-retry');
      const shouldRetry=explicit==='true'||(explicit!=='false'&&retryableStatus(response.status));
      if(!shouldRetry||attempt===maxRetries)return response;
      await wait(retryDelay(response,attempt));
    }catch(error){
      lastError=error;
      if(attempt===maxRetries)throw error;
      await wait(retryDelay(undefined,attempt));
    }
  }
  throw lastError instanceof Error?lastError:new Error('Request failed after retries');
}

export {retryableStatus};
