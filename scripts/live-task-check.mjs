// Keep CI diagnostics limited to known task metadata, never document contents,
// provider responses, credentials, or arbitrary error strings from a task.
const knownErrors=new Set(['ai_budget_exhausted','ai_rate_limit','ai_unavailable','usage_limit','processing_failed','retry_limit','invalid_priorities','invalid_result','input_too_large','threshold_changed','negation_removed']);
const knownStates=new Set(['queued','processing','ready','failed']);
function diagnostic(task){
 const state=knownStates.has(task?.status)?task.status:task?'unknown':'missing';
 const error=task?.error_code?(knownErrors.has(task.error_code)?task.error_code:'unrecognized_error'):'none';
 const attempts=Number.isSafeInteger(task?.attempts)&&task.attempts>=0?task.attempts:'unknown';
 return `state=${state}, attempts=${attempts}, error=${error}`;
}

export async function waitForLiveTask({readTask,label,ready=task=>task?.status==='ready',maxPolls=480,intervalMs=500,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 let task;
 for(let i=0;i<maxPolls;i++){
  task=await readTask();
  if(ready(task))return task;
  // Billing rejection cannot recover through queue retries alone. Fail the
  // release check immediately; never replace a required real-provider result.
  if(task?.error_code==='ai_budget_exhausted')throw Error(`${label} blocked: AI provider credits or a provider spending limit rejected the request (ai_budget_exhausted). Restore access for the configured provider project, then rerun validation. Checks have not passed.`);
  if(task?.status==='failed')throw Error(`${label} failed (${diagnostic(task)}). Checks have not passed.`);
  if(i+1<maxPolls)await wait(intervalMs);
 }
 throw Error(`${label} did not complete within the polling limit (${diagnostic(task)}). Checks have not passed.`);
}
