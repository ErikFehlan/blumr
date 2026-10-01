// Only explicit rate-limit responses can safely be repeated here.
export async function managementFetch(url,init={},options={}){
 const fetcher=options.fetcher||fetch,wait=options.wait||(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
 for(let attempt=0;attempt<6;attempt++){
  const response=await fetcher(url,init);
  if(response.status!==429||attempt===5)return response;
  const raw=response.headers.get('retry-after'),seconds=raw===null?NaN:Number(raw);
  const delay=Number.isFinite(seconds)&&seconds>=0?Math.min(seconds*1000,30000):Math.min(2000*2**attempt,30000);
  await response.body?.cancel();await wait(delay);
 }
}
