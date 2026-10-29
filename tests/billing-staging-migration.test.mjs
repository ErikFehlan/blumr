import test from 'node:test';
import assert from 'node:assert/strict';
import {applyBillingStagingMigration} from '../scripts/billing-staging-migration.mjs';

const env = {SUPABASE_PROJECT_REF: 'momfzjmycveqginxmqib', SUPABASE_ACCESS_TOKEN: 'synthetic-token'};
const hash = 'b575e919edfae10068cc4e76a2dd050c';
const prerequisites = [
  ['20261028134006', 'subscription_foundation', '93711b222f884bf45212204e598306c9'],
  ['20261028142020', 'subscription_screening_enforcement', 'e4c09c9a5f17aec92717ac87f7213a2f'],
  ['20261028151317', 'subscription_feedback_usage', 'a3e8b8774c844d275512cc35507e565a'],
  ['20261028155821', 'subscription_admin_grants', 'f93009578bafaf61d4fee52039f248ea'],
].map(([version, name, md5]) => ({version, name, md5}));
function fixture(options = {}) {
  const state = {migrations: structuredClone(prerequisites), accounts: 0, workers_paused: true, provider_usage: 8, customers: null, events: null, private_rls_tables: 0, service_boundary: null, ...options};
  const calls = [], logs = [];
  const fetchImpl = async (url, init) => {
    assert.ok(url.startsWith('https://api.supabase.com/v1/projects/momfzjmycveqginxmqib/'));
    assert.equal(init.redirect, 'error');
    const body = JSON.parse(init.body);
    calls.push({url, body, headers: init.headers});
    if (url.endsWith('/database/migrations')) {
      assert.equal(body.name, 'subscription_stripe_sandbox');
      assert.ok(body.query.startsWith('begin;'));
      assert.equal(init.headers['Idempotency-Key'], 'blumr-staging-20261028174343-' + hash);
      state.migrations.push({version: '20261029140000', name: body.name, md5: hash});
      state.customers = 'blumr_billing_private.customers'; state.events = 'blumr_billing_private.events'; state.private_rls_tables = 2; state.service_boundary = true;
      return new Response(null, {status: 200});
    }
    if (body.query.startsWith('update supabase_migrations')) {
      assert.ok(body.query.includes("md5(array_to_string(statements,E'\\n'))='" + hash + "'"));
      state.migrations.find(m => m.name === 'subscription_stripe_sandbox').version = '20261028174343';
      return Response.json([{version: '20261028174343'}]);
    }
    return Response.json([{checkpoint: state}]);
  };
  return {fetchImpl, report: message => logs.push(message), calls, logs, state};
}

test('migration runner refuses production and changed SQL before any network request', async () => {
  const f = fixture();
  await assert.rejects(applyBillingStagingMigration({...f, env: {...env, SUPABASE_PROJECT_REF: 'zqiqjzxcpznhzjengfff'}}));
  await assert.rejects(applyBillingStagingMigration({...f, env, readFileImpl: async () => 'select 1;'}));
  assert.equal(f.calls.length, 0);
});

test('migration runner stops on unsafe staging state or conflicting source history', async () => {
  for (const options of [{accounts: 1}, {workers_paused: false}, {migrations: []}, {customers: 'untracked'}, {migrations: [...prerequisites, {name: 'subscription_stripe_sandbox', md5: 'wrong'}]}]) {
    const f = fixture(options);
    await assert.rejects(applyBillingStagingMigration({...f, env}));
    assert.ok(f.calls.every(c => !c.url.endsWith('/database/migrations') && !c.body.query.startsWith('update ')));
  }
});

test('exact migration is applied once, verified, and safely aligned to repository history', async () => {
  const f = fixture();
  const result = await applyBillingStagingMigration({...f, env});
  assert.equal(result.applied_now, true);
  assert.equal(result.version, '20261028174343');
  assert.equal(result.provider_usage, 8);
  assert.equal(f.calls.filter(c => c.url.endsWith('/database/migrations')).length, 1);
  const repeated = await applyBillingStagingMigration({...f, env});
  assert.equal(repeated.applied_now, false);
  assert.equal(f.calls.filter(c => c.url.endsWith('/database/migrations')).length, 1);
  assert.ok(!f.logs.join('').includes(env.SUPABASE_ACCESS_TOKEN));
});

test('a successful earlier migration is verified without replay after response loss', async () => {
  const f = fixture({migrations: [...prerequisites, {version: '20261029140000', name: 'subscription_stripe_sandbox', md5: hash}], customers: 'blumr_billing_private.customers', events: 'blumr_billing_private.events', private_rls_tables: 2, service_boundary: true});
  const result = await applyBillingStagingMigration({...f, env});
  assert.equal(result.applied_now, false);
  assert.equal(result.version, '20261028174343');
  assert.ok(f.calls.every(c => !c.url.endsWith('/database/migrations')));
});
