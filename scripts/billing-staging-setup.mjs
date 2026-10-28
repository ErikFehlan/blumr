import {pathToFileURL} from 'node:url';

const project = 'momfzjmycveqginxmqib';
const app = 'https://feat-subscription-foundation.blumr.pages.dev';
const vaultNames = ['billing_staging_webhook_secret', 'billing_staging_reconcile_secret'];

// Configuration only: no DDL, deployments, fixtures, provider calls or activation.
// Values travel directly from staging Vault to staging's Edge Function secret store.
export async function configureBillingStaging({env = process.env, fetchImpl = fetch, report = console.log} = {}) {
  if (env.SUPABASE_PROJECT_REF !== project || !env.SUPABASE_ACCESS_TOKEN?.trim()) {
    throw new Error('Billing setup requires the owned staging project and its existing deployment credential.');
  }
  const stripeKey = env.STRIPE_BILLING_SANDBOX_KEY?.trim();
  if (stripeKey && !/^[sr]k_test_[A-Za-z0-9]+$/.test(stripeKey)) {
    throw new Error('Only a sandbox Stripe server key can be installed.');
  }
  async function request(url, options, label) {
    let response;
    try { response = await fetchImpl(url, {...options, redirect: 'error', signal: AbortSignal.timeout(30000)}); }
    catch { throw new Error(label + ' could not be completed; no response or credential was logged.'); }
    if (!response.ok) throw new Error(label + ' failed (HTTP ' + response.status + '); no response or credential was logged.');
    try { return await response.json(); } catch { throw new Error(label + ' returned an invalid response.'); }
  }
  const api = (path, method = 'GET', body) => request(`https://api.supabase.com/v1/projects/${project}${path}`, {
    method,
    headers: {Authorization: 'Bearer ' + env.SUPABASE_ACCESS_TOKEN.trim(), 'Content-Type': 'application/json'},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  }, 'Staging management operation');
  const status = () => request(`https://${project}.supabase.co/functions/v1/billing-sandbox`, {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({action: 'status'}),
  }, 'Disabled billing check');
  if ((await status()).enabled !== false) throw new Error('Billing must already be disabled before preparatory setup.');
  const [state] = await api('/database/query', 'POST', {query: `select jsonb_build_object(
    'accounts',(select count(*) from public.subscription_accounts),
    'provider_usage',(select count(*) from public.ai_provider_usage),
    'ai_paused',(select count(*)=2 and bool_and(not active) from cron.job where jobname in ('ancalagon-criteria-worker','ancalagon-job-reassessment')),
    'reconcile_paused',(select count(*)=1 and bool_and(not active) from cron.job where jobname='blumr-billing-reconcile')
  ) as checkpoint;`});
  if (!state?.checkpoint || state.checkpoint.accounts !== 0 || state.checkpoint.ai_paused !== true || state.checkpoint.reconcile_paused !== true) {
    throw new Error('Preparatory setup requires no subscription accounts and all billing/AI workers paused.');
  }
  const vault = await api('/database/query', 'POST', {query: `select name,decrypted_secret from vault.decrypted_secrets where name in ('billing_staging_webhook_secret','billing_staging_reconcile_secret');`});
  const values = Object.fromEntries(vault.map(row => [row.name, row.decrypted_secret]));
  if (vault.length !== 2 || vaultNames.some(name => typeof values[name] !== 'string') ||
      !/^whsec_[A-Za-z0-9]+$/.test(values.billing_staging_webhook_secret) ||
      !/^[a-f0-9]{64}$/.test(values.billing_staging_reconcile_secret)) {
    throw new Error('The two existing staging Vault credentials are missing or invalid.');
  }
  const configuration = {
    AI_PROVIDER_CALLS_DISABLED: 'true',
    STRIPE_BILLING_SANDBOX_ENABLED: 'false',
    SUBSCRIPTION_FOUNDATION_ENABLED: 'false',
    STRIPE_PRICE_BASIC: 'price_1UVbIzClb9pZVTfu95lWfhhL',
    STRIPE_PRICE_ADVANCED: 'price_1UVbJAClb9pZVTfuuHGa13Op',
    STRIPE_PRICE_PRO: 'price_1UVbJDClb9pZVTfuIimgv6ad',
    STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_1UVbJJClb9pZVTfuAtCZMMrU',
    BILLING_APP_URL: app,
    STRIPE_WEBHOOK_SECRET: values.billing_staging_webhook_secret,
    BILLING_RECONCILE_SECRET: values.billing_staging_reconcile_secret,
    ...(stripeKey ? {STRIPE_SECRET_KEY: stripeKey} : {}),
  };
  await api('/secrets', 'POST', Object.entries(configuration).map(([name, value]) => ({name, value})));
  const secrets = await api('/secrets');
  if (Object.keys(configuration).some(name => !secrets.some(secret => secret.name === name))) {
    throw new Error('Runtime configuration metadata is incomplete. Billing remains disabled.');
  }
  if ((await status()).enabled !== false) throw new Error('Billing unexpectedly reports enabled after setup.');
  const result = {
    project,
    configured: Object.keys(configuration).length,
    billing_enabled: false,
    subscription_foundation_enabled: false,
    ai_provider_calls_disabled: true,
    stripe_key_present: secrets.some(secret => secret.name === 'STRIPE_SECRET_KEY'),
    stripe_key_installed: Boolean(stripeKey),
    provider_usage_before: state.checkpoint.provider_usage,
  };
  report(JSON.stringify(result));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  configureBillingStaging().catch(error => { console.error(error.message); process.exitCode = 1; });
}
