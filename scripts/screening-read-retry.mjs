// Only use for idempotent screening reads/cache refreshes, never paid selection
// or document writes. Preserve authorization and validation failures unchanged.
export async function screeningRead(request,{wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),onRetry=()=>{}}={}){
 for(let attempt=0;attempt<3;attempt++){
  let result;
  try{result=await request();}
  catch(error){if(attempt===2||!['TypeError','TimeoutError','AbortError'].includes(error?.name))throw error;onRetry('transport');await wait(250*(2**attempt));continue;}
  if(attempt===2||![502,503,504].includes(result.status))return result;
  onRetry(result.status);await wait(250*(2**attempt));
 }
}
