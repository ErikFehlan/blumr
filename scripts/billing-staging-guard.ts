// Included only by the billing staging deployment procedure, never production.
const stagingHost = 'momfzjmycveqginxmqib.supabase.co';
if (new URL(Deno.env.get('SUPABASE_URL') || 'https://invalid.invalid').hostname !== stagingHost) {
  throw new Error('billing_staging_project_mismatch');
}
// Hosted Edge Functions expose read-only environment variables. Require the
// deployment-level lock rather than attempting to change it during startup.
if (Deno.env.get('AI_PROVIDER_CALLS_DISABLED') !== 'true') {
  throw new Error('billing_staging_provider_lock_required');
}
const stagingFetch = globalThis.fetch;
globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.protocol !== 'https:' || url.hostname !== stagingHost || url.port || url.username || url.password) {
    throw new Error('provider_calls_disabled');
  }
  return stagingFetch(input, {...init, redirect: 'error'});
};
