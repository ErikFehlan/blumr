// Local development can disable provider traffic even when a key is present.
// This check lives below routing/retries; no caller can opt out with an option.
export function assertProviderTrafficAllowed(){
 if(Deno.env.get('AI_PROVIDER_CALLS_DISABLED')==='true')throw new Error('provider_calls_disabled');
}
