// Usage fields are metadata only; never retain prompts, resumes, or model output.
export function providerUsage(response) {
 const usage=response?.usage;
 if(typeof response?.id!=='string'||typeof response?.model!=='string'||
  !Number.isSafeInteger(usage?.input_tokens)||usage.input_tokens<0||
  !Number.isSafeInteger(usage?.output_tokens)||usage.output_tokens<0)return null;
 const input=usage.input_tokens,details=usage.input_tokens_details||{};
 const cached=Number.isSafeInteger(details.cached_tokens)&&details.cached_tokens>=0?Math.min(input,details.cached_tokens):0;
 // Missing is unknown, not zero: older responses did not expose cache writes.
 const writes=Number.isSafeInteger(details.cache_write_tokens)&&details.cache_write_tokens>=0&&details.cache_write_tokens<=input-cached?details.cache_write_tokens:null;
 return {response_id:response.id,model:response.model,input_tokens:input,cached_input_tokens:cached,
  cache_write_input_tokens:writes,output_tokens:usage.output_tokens};
}
