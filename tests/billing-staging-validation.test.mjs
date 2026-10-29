import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBillingStaging, PROJECT} from '../scripts/billing-staging-validation.mjs';
const env = {SUPABASE_PROJECT_REF: PROJECT, SUPABASE_ACCESS_TOKEN: 'private-management', STRIPE_BILLING_SANDBOX_KEY: 'rk_test_private'};
test('hosted validation rejects production, live/full keys, and unknown operations before transport', async () => {
  let calls = 0;
  for (const change of [{mode: 'anything'}, {env: {...env, SUPABASE_PROJECT_REF: 'production'}}, {env: {...env, STRIPE_BILLING_SANDBOX_KEY: 'rk_live_private'}}, {env: {...env, STRIPE_BILLING_SANDBOX_KEY: 'sk_test_private'}}]) {
    await assert.rejects(validateBillingStaging({mode: 'prepare', env, fetchImpl: async () => {calls++;}, ...change}));
  }
  assert.equal(calls, 0);
});
test('changed usage, active AI workers, foreign accounts, or missing migration stop before Stripe or mutation', async () => {
  for (const changed of [{provider_usage: 9}, {ai_workers_paused: false}, {other_accounts: 1}, {other_mappings: 1}, {billing_migration: false}]) {
    const calls = [];
    await assert.rejects(validateBillingStaging({mode: 'prepare', env, fetchImpl: async (url, options) => {
      calls.push({url, options});
      return Response.json([{checkpoint: {provider_usage: 8, ai_workers_paused: true, other_accounts: 0, other_mappings: 0, billing_migration: true, ...changed}}]);
    }}), /baseline changed/);
    assert.equal(calls.length, 1);
    assert.match(JSON.parse(calls[0].options.body).query, /^select/);
    assert.equal(calls[0].options.redirect, 'error');
  }
});
test('transport and remote API errors cannot expose credentials or response messages', async () => {
  const secret = 'rk_test_donotprint';
  await assert.rejects(validateBillingStaging({mode: 'prepare', env, fetchImpl: async () => {throw Error(secret);}}), error => !error.message.includes(secret));
  await assert.rejects(validateBillingStaging({mode: 'prepare', env, fetchImpl: async () => Response.json({error: {message: secret, code: secret + ' unsafe', param: secret + ' unsafe'}}, {status: 403})}), error => !error.message.includes(secret) && error.message.includes('HTTP 403'));
});
