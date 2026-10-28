import test from 'node:test';
import assert from 'node:assert/strict';
import {configureBillingStaging} from '../scripts/billing-staging-setup.mjs';

const stage = 'momfzjmycveqginxmqib';
const env = {SUPABASE_PROJECT_REF: stage, SUPABASE_ACCESS_TOKEN: 'synthetic-token'};
function fixture({accounts = 0, paused = true, enabled = false, missingVault = false, vaultFailure = false} = {}) {
  const calls = [], logs = [];
  let installed = [];
  const webhook = 'whsec_SyntheticSigningSecret';
  const worker = 'a'.repeat(64);
  const fetchImpl = async (url, options) => {
    calls.push({url, options});
    assert.equal(options.redirect, 'error');
    const body = options.body ? JSON.parse(options.body) : null;
    if (url === `https://${stage}.supabase.co/functions/v1/billing-sandbox`) {
      assert.equal(body.action, 'status');
      assert.equal(options.headers.Authorization, undefined);
      return Response.json({enabled});
    }
    assert.ok(url.startsWith(`https://api.supabase.com/v1/projects/${stage}/`));
    assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
    if (url.endsWith('/database/query') && body.query.includes('as checkpoint')) return Response.json([{checkpoint: {accounts, ai_paused: paused, reconcile_paused: paused, provider_usage: 8}}]);
    if (url.endsWith('/database/query') && body.query.includes('vault.decrypted_secrets')) {
      if (vaultFailure) throw new Error(webhook + worker + env.SUPABASE_ACCESS_TOKEN);
      return Response.json(missingVault ? [] : [{name: 'billing_staging_webhook_secret', decrypted_secret: webhook}, {name: 'billing_staging_reconcile_secret', decrypted_secret: worker}]);
    }
    if (url.endsWith('/secrets') && options.method === 'POST') { installed = body; return new Response(null, {status: 201}); }
    if (url.endsWith('/secrets') && options.method === 'GET') return Response.json(installed.map(({name}) => ({name})));
    throw new Error('Unexpected operation');
  };
  return {fetchImpl, report: message => logs.push(message), calls, logs, webhook, worker, installed: () => installed};
}

test('staging setup refuses other projects and live keys before network access', async () => {
  for (const bad of [{...env, SUPABASE_PROJECT_REF: 'zqiqjzxcpznhzjengfff'}, {...env, STRIPE_BILLING_SANDBOX_KEY: 'rk_live_synthetic'}]) {
    const f = fixture();
    await assert.rejects(configureBillingStaging({...f, env: bad}));
    assert.equal(f.calls.length, 0);
  }
});

test('staging setup transfers only named Vault secrets and keeps all features disabled', async () => {
  const f = fixture();
  const result = await configureBillingStaging({...f, env});
  const installed = Object.fromEntries(f.installed().map(({name, value}) => [name, value]));
  assert.equal(installed.AI_PROVIDER_CALLS_DISABLED, 'true');
  assert.equal(installed.STRIPE_BILLING_SANDBOX_ENABLED, 'false');
  assert.equal(installed.SUBSCRIPTION_FOUNDATION_ENABLED, 'false');
  assert.equal(installed.STRIPE_WEBHOOK_SECRET, f.webhook);
  assert.equal(installed.BILLING_RECONCILE_SECRET, f.worker);
  assert.equal(installed.STRIPE_SECRET_KEY, undefined);
  assert.equal(result.stripe_key_present, false);
  assert.equal(f.calls.filter(c => c.url.endsWith('/secrets') && c.options.method === 'POST').length, 1);
  for (const secret of [f.webhook, f.worker, env.SUPABASE_ACCESS_TOKEN]) assert.ok(!f.logs.join('').includes(secret));
});

test('sandbox key stays in the runtime secret request and never appears in evidence', async () => {
  const f = fixture(), key = 'rk_test_SyntheticRestrictedKey';
  const result = await configureBillingStaging({...f, env: {...env, STRIPE_BILLING_SANDBOX_KEY: key}});
  assert.equal(f.installed().find(s => s.name === 'STRIPE_SECRET_KEY').value, key);
  assert.equal(result.stripe_key_installed, true);
  assert.ok(!f.logs.join('').includes(key));
});

test('active billing, subscriber state, running workers and invalid Vault state stop before configuration writes', async () => {
  for (const options of [{enabled: true}, {accounts: 1}, {paused: false}, {missingVault: true}, {vaultFailure: true}]) {
    const f = fixture(options);
    await assert.rejects(configureBillingStaging({...f, env}), error => !error.message.includes(f.webhook) && !error.message.includes(f.worker) && !error.message.includes(env.SUPABASE_ACCESS_TOKEN));
    assert.equal(f.installed().length, 0);
  }
});
