import {createHash, createHmac} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export const PROJECT = 'momfzjmycveqginxmqib';
export const RUN = '20261029-v1';
const base = `https://${PROJECT}.supabase.co`;
const origin = 'https://feat-subscription-foundation.blumr.pages.dev';
const version = '2026-09-30.endive';
const plans = {
  basic: {price: 'price_1UVbIzClb9pZVTfu95lWfhhL', amount: 2900, limits: [1000, 0, 0]},
  advanced: {price: 'price_1UVbJAClb9pZVTfuuHGa13Op', amount: 7900, limits: [1000, 100, 0]},
  pro: {price: 'price_1UVbJDClb9pZVTfuIimgv6ad', amount: 15000, limits: [1000, 100, 500]},
};
const portal = 'bpc_1UVbJJClb9pZVTfuAtCZMMrU';
const modes = new Set(['prepare', 'inspect', 'verify', 'stop', 'clockprepare', 'security', 'rollback']);
const ensure = (condition, message) => { if (!condition) throw new Error(message); };
const emailFor = tier => `blumr-billing-${RUN}-${tier}@example.invalid`;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);

export async function validateBillingStaging({mode, env = process.env, fetchImpl = fetch, report = console.log} = {}) {
  ensure(modes.has(mode), 'Unknown staging validation mode.');
  ensure(env.SUPABASE_PROJECT_REF === PROJECT && env.SUPABASE_ACCESS_TOKEN?.trim(), 'Only the owned staging project is allowed.');
  const key = env.STRIPE_BILLING_SANDBOX_KEY?.trim();
  ensure(/^rk_test_[A-Za-z0-9]+$/.test(key || ''), 'The restricted sandbox key is required.');
  const sessions = [];
  async function send(url, options, label, expected = 200) {
    const parsed = new URL(url);
    ensure(['https://api.supabase.com', base, 'https://api.stripe.com'].includes(parsed.origin) && !parsed.username && !parsed.password, 'Unexpected validation destination.');
    let response;
    try { response = await fetchImpl(url, {...options, redirect: 'error', signal: AbortSignal.timeout(30000)}); }
    catch { throw new Error(`${label}: transport failed; no response or credential was logged.`); }
    const data = await response.json().catch(() => null);
    const statuses = Array.isArray(expected) ? expected : [expected];
    if (!statuses.includes(response.status)) {
      const code = data?.error?.code || data?.code;
      const param = data?.error?.param;
      const safe = value => typeof value === 'string' && /^[a-zA-Z0-9_\[\].]{1,100}$/.test(value) && !/(?:[rs]k_(?:test|live)_|sbp_|eyJ)/.test(value) && !value.includes(key) && !value.includes(env.SUPABASE_ACCESS_TOKEN.trim()) ? value : 'unavailable';
      throw new Error(`${label}: HTTP ${response.status}; code=${safe(code)}; parameter=${safe(param)}.`);
    }
    return data;
  }
  const management = (path, method = 'GET', body) => send(`https://api.supabase.com/v1/projects/${PROJECT}${path}`, {
    method, headers: {Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN.trim()}`, 'Content-Type': 'application/json'},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  }, `Staging management ${method} ${path.split('?')[0]}`, [200, 201, 204]);
  const sql = (query, parameters = []) => management('/database/query', 'POST', {query, parameters});
  const stripe = path => send(`https://api.stripe.com/v1/${path}`, {
    method: 'GET', headers: {Authorization: `Bearer ${key}`, 'Stripe-Version': version},
  }, `Restricted Stripe ${path.split('?')[0]}`);
  const checkpoint = async () => (await sql(`select jsonb_build_object(
    'provider_usage',(select count(*) from public.ai_provider_usage),
    'ai_workers_paused',(select count(*)=2 and bool_and(not active) from cron.job where jobname in ('ancalagon-criteria-worker','ancalagon-job-reassessment')),
    'other_accounts',(select count(*) from public.subscription_accounts a join auth.users u on u.id=a.user_id where coalesce(u.raw_app_meta_data->>'billing_validation','')<>$1),
    'other_mappings',(select count(*) from blumr_billing_private.customers b join auth.users u on u.id=b.user_id where coalesce(u.raw_app_meta_data->>'billing_validation','')<>$1),
    'billing_migration',(select count(*)=1 from supabase_migrations.schema_migrations where version='20261028174343' and name='subscription_stripe_sandbox' and md5(array_to_string(statements,E'\\n'))='b575e919edfae10068cc4e76a2dd050c')
  ) as checkpoint`, [RUN]))[0]?.checkpoint;
  const before = await checkpoint();
  ensure(before?.provider_usage === 8 && before.ai_workers_paused === true && before.other_accounts === 0 && before.other_mappings === 0 && before.billing_migration === true, 'Staging baseline changed; validation stopped.');

  // Check the actual restricted credential against the fixed sandbox catalog.
  for (const [tier, plan] of Object.entries(plans)) {
    const price = await stripe('prices/' + plan.price);
    ensure(price.id === plan.price && price.livemode === false && price.active && price.unit_amount === plan.amount && price.currency === 'usd' && price.recurring?.interval === 'month' && price.recurring?.interval_count === 1, `Unexpected ${tier} sandbox price.`);
  }
  const settings = await stripe('billing_portal/configurations/' + portal);
  ensure(settings.id === portal && settings.livemode === false && settings.active && settings.features?.subscription_cancel?.mode === 'at_period_end' && settings.features?.subscription_update?.enabled === false && settings.features?.payment_method_update?.enabled === true && settings.features?.invoice_history?.enabled === true, 'Unexpected sandbox portal configuration.');
  const keys = await management('/api-keys?reveal=true');
  const service = keys.find(k => k.name === 'service_role')?.api_key;
  const anon = keys.find(k => k.name === 'anon')?.api_key;
  ensure(service && anon, 'Staging Auth keys unavailable.');
  const existingLock = (await management('/secrets')).find(s => s.name === 'AI_PROVIDER_CALLS_DISABLED');
  ensure(existingLock && (!existingLock.digest || existingLock.digest === createHash('sha256').update('true').digest('hex')), 'Runtime AI lock is not verified.');
  const request = (path, access, body, expected = 200, method = 'POST') => send(base + path, {
    method, headers: {apikey: access === service ? service : anon, Authorization: `Bearer ${access}`, 'Content-Type': 'application/json', Origin: origin},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  }, `Staging ${method} ${path.split('?')[0]}`, expected);
  const billing = (access, body, expected = 200) => request('/functions/v1/billing-sandbox', access, body, expected);
  const runtime = enabled => management('/secrets', 'POST', [
    {name: 'AI_PROVIDER_CALLS_DISABLED', value: 'true'},
    {name: 'STRIPE_BILLING_SANDBOX_ENABLED', value: String(enabled)},
    {name: 'SUBSCRIPTION_FOUNDATION_ENABLED', value: String(enabled)},
  ]);
  const users = [];
  try {
    const clockExists = (await sql('select id from auth.users where email=$1', [emailFor('lifecycle')])).length === 1;
    const fixtures = [...Object.keys(plans), ...(clockExists || mode === 'clockprepare' ? ['lifecycle'] : [])];
    for (const fixture of fixtures) {
      const tier = fixture === 'lifecycle' ? 'pro' : fixture;
      const email = emailFor(fixture);
      let rows = await sql('select id,raw_app_meta_data->>\'billing_validation\' as fixture from auth.users where email=$1', [email]);
      ensure(rows.length <= 1 && rows.every(row => row.fixture === RUN && uuid(row.id)), 'Fixture identity conflict; refusing to use an existing user.');
      const password = createHmac('sha256', key).update(`blumr-billing-fixture:${PROJECT}:${email}`).digest('base64url');
      if (!rows.length) {
        ensure(mode === 'prepare' || (mode === 'clockprepare' && fixture === 'lifecycle'), 'Prepare staging fixtures first.');
        await sql('insert into public.beta_access(email) values($1) on conflict do nothing', [email]);
        const created = await request('/auth/v1/admin/users', service, {email, password, email_confirm: true, app_metadata: {billing_validation: RUN}, user_metadata: {display_name: 'Disposable billing validation'}}, [200, 201]);
        ensure(uuid(created.id) && created.email === email && created.app_metadata?.billing_validation === RUN, 'Unexpected created fixture identity.');
        rows = [{id: created.id, fixture: RUN}];
      }
      const session = await request('/auth/v1/token?grant_type=password', anon, {email, password});
      ensure(session.user?.id === rows[0].id && session.user?.email_confirmed_at && session.access_token, 'Fixture session mismatch.');
      const user = {tier, fixture, id: rows[0].id, access: session.access_token};
      sessions.push(user.access);
      ensure(await request('/rest/v1/rpc/is_app_admin', user.access, {}) === false, 'Fixture unexpectedly has admin access.');
      const memberships = await request(`/rest/v1/workspace_members?select=workspace_id&user_id=eq.${user.id}`, user.access, undefined, 200, 'GET');
      ensure(memberships.length === 1 && uuid(memberships[0].workspace_id), 'Fixture workspace mismatch.');
      user.workspace = memberships[0].workspace_id;
      users.push(user);
    }
    if (mode === 'clockprepare') {
      const customer = await stripe('customers/cus_VWzIFSxAUnfCza');
      ensure(customer.id === 'cus_VWzIFSxAUnfCza' && customer.livemode === false && customer.test_clock === 'clock_1UVvJQClb9pZVTfuZS1cHhtM' && customer.metadata?.billing_validation === RUN && !customer.email, 'Unexpected historical fixture.');
      const user = users.find(u => u.fixture === 'lifecycle');
      const rpc = (p_action, p_args) => request('/rest/v1/rpc/subscription_billing_command', service, {p_action, p_args});
      const lease = await rpc('claim', {user: user.id, purpose: 'portal'});
      try {
        ensure(!lease.customer_id || lease.customer_id === customer.id, 'Historical fixture already mapped elsewhere.');
        await rpc('customer', {user: user.id, lease: lease.lease_id, customer: customer.id});
      } finally { await rpc('release', {user: user.id, lease: lease.lease_id}); }
      report(JSON.stringify({case: 'clock_fixture_mapped', user: user.id, customer: customer.id, clock: customer.test_clock}));
    } else if (mode === 'prepare') {
      // Global database pause backs up the deployed network guard and env lock.
      await sql('update public.security_limits set ai_paused=true where id=true');
      await runtime(true);
      const metadata = await management('/secrets');
      const lock = metadata.find(s => s.name === 'AI_PROVIDER_CALLS_DISABLED');
      ensure(lock && (!lock.digest || lock.digest === createHash('sha256').update('true').digest('hex')), 'Runtime AI lock could not be verified.');
      for (const user of users) {
        const status = await billing(user.access, {action: 'status'});
        ensure(status.enabled && status.eligible, 'Fixture billing is not eligible.');
        await billing(user.access, {action: 'checkout', tier: user.tier, customer: 'cus_foreign'}, 400);
        const checkout = await billing(user.access, {action: 'checkout', tier: user.tier});
        ensure(typeof checkout.url === 'string' && new URL(checkout.url).origin === 'https://checkout.stripe.com', 'Unexpected checkout destination.');
        const repeat = await billing(user.access, {action: 'checkout', tier: user.tier});
        ensure(repeat.url === checkout.url, 'Checkout retry created a different session.');
        await billing(user.access, {action: 'checkout', tier: user.tier === 'basic' ? 'pro' : 'basic'}, 409);
        const [mapping] = await sql('select customer_id,checkout_session from blumr_billing_private.customers where user_id=$1', [user.id]);
        ensure(/^cus_[A-Za-z0-9]+$/.test(mapping?.customer_id) && /^cs_test_[A-Za-z0-9]+$/.test(mapping?.checkout_session), 'Checkout mapping missing.');
        report(JSON.stringify({case: 'checkout_prepared', tier: user.tier, user: user.id, customer: mapping.customer_id, session: mapping.checkout_session, retry_reused_session: true}));
      }
      await sql("select cron.alter_job(jobid,active:=true) from cron.job where jobname='blumr-billing-reconcile'");
    } else if (mode === 'stop') {
      for (const user of users) {
        const [mapping] = await sql('select customer_id from blumr_billing_private.customers where user_id=$1', [user.id]);
        if (!mapping?.customer_id) continue;
        const subscriptions = await stripe(`subscriptions?customer=${mapping.customer_id}&status=all&limit=100`);
        ensure(!subscriptions.has_more && subscriptions.data.every(s => s.livemode === false && ['canceled', 'incomplete_expired'].includes(s.status)), 'Active sandbox subscription must be canceled before shutdown.');
      }
      await sql("select cron.alter_job(jobid,active:=false) from cron.job where jobname='blumr-billing-reconcile'");
      await runtime(false);
    } else {
      // Reconciliation updates the optimistic admin revision even when paid state is unchanged.
      const snapshot = async () => (await sql(`select jsonb_build_object(
        'accounts',(select jsonb_agg(to_jsonb(a)-'admin_revision' order by a.id) from public.subscription_accounts a),
        'periods',(select jsonb_agg(to_jsonb(p) order by p.id) from public.subscription_periods p),
        'evaluations',(select jsonb_agg(to_jsonb(e) order by e.id) from public.subscription_evaluations e)
      ) as state`))[0].state;
      const initialState = await snapshot();
      if (mode === 'security') {
        const [secret] = await sql("select decrypted_secret from vault.decrypted_secrets where name='billing_staging_webhook_secret'");
        ensure(/^whsec_[A-Za-z0-9]+$/.test(secret?.decrypted_secret), 'Webhook credential missing.');
        const event = {id: 'evt_blumrValidation20261029', api_version: version, livemode: false, type: 'customer.subscription.updated', data: {object: {customer: 'cus_VWz64PllM8UJOK', status: 'canceled', metadata: {user_id: users[2].id}}}};
        const deliver = async (value, expected, age = 0, invalid = false) => {
          const raw = JSON.stringify(value), t = Math.floor(Date.now()/1000) - age;
          const signature = createHmac('sha256', invalid ? 'invalid-signature-fixture' : secret.decrypted_secret).update(t + '.' + raw).digest('hex');
          return send(base + '/functions/v1/stripe-webhook', {method: 'POST', headers: {'Content-Type': 'application/json', 'stripe-signature': `t=${t},v1=${signature}`}, body: raw}, 'Hosted webhook security case', expected);
        };
        await deliver(event, 400, 301);
        await deliver(event, 400, 0, true);
        await deliver({...event, livemode: true}, 400);
        await deliver({...event, account: 'acct_foreign'}, 400);
        await deliver({...event, api_version: '2020-01-01'}, 400);
        await deliver(event, 200);
        await deliver(event, 200);
        await deliver({...event, type: 'customer.subscription.deleted'}, 409);
        const [receipt] = await sql('select count(*)::int as count from blumr_billing_private.events where id=$1', [event.id]);
        ensure(receipt.count === 1, 'Duplicate event created another receipt.');
        await request('/functions/v1/billing-reconcile', users[0].access, {}, 401);
        report(JSON.stringify({case: 'webhook_security', invalid_signature_rejected: true, stale_rejected: true, wrong_mode_version_account_rejected: true, duplicate_receipts: 1, conflicting_payload_rejected: true, public_worker_denied: true}));
      }
      if (mode === 'rollback') {
        await management('/secrets', 'POST', [{name: 'STRIPE_CHECKOUT_PAUSED', value: 'true'}]);
      }
      try {
      const [worker] = await sql("select decrypted_secret from vault.decrypted_secrets where name='billing_staging_reconcile_secret'");
      ensure(/^[a-f0-9]{64}$/.test(worker?.decrypted_secret), 'Worker credential missing.');
      // Only schedule our fixture mappings sooner; do not modify paid evidence.
      await sql("update blumr_billing_private.customers b set next_reconcile_at=now() from auth.users u where b.user_id=u.id and u.raw_app_meta_data->>'billing_validation'=$1 and coalesce(b.lease_until,'-infinity')<now()", [RUN]);
      for (let i = 0; i < users.length; i++) await request('/functions/v1/billing-reconcile', worker.decrypted_secret, {});
      for (const user of users) {
        const rows = await request('/rest/v1/subscription_accounts?select=id,plan_code,status,source,current_period_id', user.access, undefined, 200, 'GET');
        const other = users.find(u => u.id !== user.id);
        ensure((await request(`/rest/v1/subscription_accounts?select=id&user_id=eq.${other.id}`, user.access, undefined, 200, 'GET')).length === 0, 'Cross-user subscription data was exposed.');
        await request('/rest/v1/rpc/subscription_billing_command', user.access, {p_action: 'status', p_args: {user: user.id}}, [401, 403, 404]);
        if (mode === 'rollback') {
          await billing(user.access, {action: 'checkout', tier: user.tier}, 503);
          ensure(new URL((await billing(user.access, {action: 'portal'})).url).origin === 'https://billing.stripe.com', 'Rollback stranded billing management.');
        }
        if (mode === 'verify') {
          ensure(rows.length === 1 && rows[0].source === 'stripe' && rows[0].status === 'active' && rows[0].plan_code === `${user.tier}-v1`, 'Expected paid fixture plan is not active.');
          const periods = await request(`/rest/v1/subscription_periods?select=rules_limit,shortlist_ai_limit,deep_ai_limit&id=eq.${rows[0].current_period_id}`, user.access, undefined, 200, 'GET');
          ensure(periods.length === 1 && JSON.stringify([periods[0].rules_limit, periods[0].shortlist_ai_limit, periods[0].deep_ai_limit]) === JSON.stringify(plans[user.tier].limits), 'Paid fixture allowances differ from the catalog.');
          const portalSession = await billing(user.access, {action: 'portal'});
          ensure(new URL(portalSession.url).origin === 'https://billing.stripe.com', 'Unexpected portal destination.');
          await billing(user.access, {action: 'checkout', tier: user.tier}, 409);
        }
        report(JSON.stringify({case: 'fixture_state', fixture: user.fixture, tier: user.tier, accounts: rows.map(({plan_code, status, source, current_period_id}) => ({plan_code, status, source, current_period_id})), cross_user_isolated: true}));
      }
      if (mode === 'security' || mode === 'rollback') {
        ensure(JSON.stringify(await snapshot()) === JSON.stringify(initialState), 'Canonical reconciliation changed ledger during replay or rollback.');
        report(JSON.stringify({case: mode, ledger_preserved: true, canonical_state_preserved: true}));
      }
      } finally {
        if (mode === 'rollback') await management('/secrets', 'POST', [{name: 'STRIPE_CHECKOUT_PAUSED', value: 'false'}]);
      }
    }
    const after = await checkpoint();
    ensure(after.provider_usage === before.provider_usage && after.ai_workers_paused && after.other_accounts === 0 && after.other_mappings === 0, 'Staging safety checkpoint changed.');
    report(JSON.stringify({mode, project: PROJECT, provider_usage: after.provider_usage, paid_ai_disabled: true, real_user_accounts: 0, catalog_verified: true}));
  } finally {
    for (const access of sessions) await request('/auth/v1/logout?scope=local', access, undefined, [200, 204]).catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  validateBillingStaging({mode: process.argv[2]}).catch(error => {console.error(error.message); process.exitCode = 1;});
}
