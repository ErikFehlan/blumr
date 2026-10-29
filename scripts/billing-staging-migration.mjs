import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const project = 'momfzjmycveqginxmqib';
const version = '20261028174343';
const name = 'subscription_stripe_sandbox';
const expectedHash = 'b575e919edfae10068cc4e76a2dd050c';
const prerequisites = [
  ['20261028134006', 'subscription_foundation', '93711b222f884bf45212204e598306c9'],
  ['20261028142020', 'subscription_screening_enforcement', 'e4c09c9a5f17aec92717ac87f7213a2f'],
  ['20261028151317', 'subscription_feedback_usage', 'a3e8b8774c844d275512cc35507e565a'],
  ['20261028155821', 'subscription_admin_grants', 'f93009578bafaf61d4fee52039f248ea'],
];
const checkpointQuery = `select jsonb_build_object(
  'migrations',(select jsonb_agg(jsonb_build_object('version',version,'name',name,'md5',md5(array_to_string(statements,E'\\n')))) from supabase_migrations.schema_migrations where name like 'subscription_%'),
  'customers',to_regclass('blumr_billing_private.customers'),
  'events',to_regclass('blumr_billing_private.events'),
  'accounts',(select count(*) from public.subscription_accounts),
  'provider_usage',(select count(*) from public.ai_provider_usage),
  'workers_paused',(select count(*)=3 and bool_and(not active) from cron.job where jobname in ('ancalagon-criteria-worker','ancalagon-job-reassessment','blumr-billing-reconcile')),
  'private_rls_tables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='blumr_billing_private' and c.relname in ('customers','events') and c.relkind='r' and c.relrowsecurity),
  'service_boundary',(select not p.prosecdef and has_function_privilege('service_role',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('authenticated',p.oid,'execute') from pg_proc p where p.oid=to_regprocedure('public.subscription_billing_command(text,jsonb)'))
) as checkpoint;`;

// Uses the documented Management migration endpoint with the existing deployment
// credential. Only this exact reviewed migration and staging project are allowed.
export async function applyBillingStagingMigration({env = process.env, fetchImpl = fetch, readFileImpl = readFile, report = console.log} = {}) {
  if (env.SUPABASE_PROJECT_REF !== project || !env.SUPABASE_ACCESS_TOKEN?.trim()) throw new Error('The owned staging project and existing deployment credential are required.');
  const sql = await readFileImpl(new URL(`../supabase/migrations/${version}_${name}.sql`, import.meta.url), 'utf8');
  if (createHash('md5').update(sql).digest('hex') !== expectedHash) throw new Error('The reviewed billing migration checksum changed; deployment stopped.');
  async function api(path, body, idempotencyKey) {
    let response;
    try {
      response = await fetchImpl(`https://api.supabase.com/v1/projects/${project}${path}`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
        headers: {Authorization: 'Bearer ' + env.SUPABASE_ACCESS_TOKEN.trim(), 'Content-Type': 'application/json', ...(idempotencyKey ? {'Idempotency-Key': idempotencyKey} : {})},
        body: JSON.stringify(body),
      });
    } catch { throw new Error('Staging migration request did not complete. Inspect migration history before retrying; no credential or response was logged.'); }
    if (!response.ok) throw new Error('Staging migration operation failed (HTTP ' + response.status + '); no credential or response was logged.');
    if (path === '/database/migrations') return;
    try { return await response.json(); } catch { throw new Error('Staging migration verification returned an invalid response.'); }
  }
  const checkpoint = async () => (await api('/database/query', {query: checkpointQuery}))[0]?.checkpoint;
  function validateState(state) {
    if (!state || state.accounts !== 0 || state.workers_paused !== true || !Array.isArray(state.migrations)) throw new Error('Staging must have no subscription accounts and all AI/billing workers paused.');
    for (const [priorVersion, priorName, hash] of prerequisites) {
      const records = state.migrations.filter(m => m.name === priorName);
      if (records.length !== 1 || records[0].version !== priorVersion || records[0].md5 !== hash) throw new Error('A prerequisite migration does not match the reviewed source.');
    }
    const records = state.migrations.filter(m => m.name === name);
    if (records.length > 1 || records.some(m => m.md5 !== expectedHash)) throw new Error('Billing migration history conflicts with the reviewed source.');
    return records[0];
  }
  const before = await checkpoint();
  const existing = validateState(before);
  if (!existing) {
    if (before.customers || before.events) throw new Error('Billing tables exist without matching migration history; deployment stopped for inspection.');
    await api('/database/migrations', {name, query: sql}, `blumr-staging-${version}-${expectedHash}`);
  }
  let after = await checkpoint();
  const applied = validateState(after);
  if (!applied || !after.customers || !after.events || after.private_rls_tables !== 2 || after.service_boundary !== true || after.provider_usage !== before.provider_usage) throw new Error('Hosted billing migration verification failed. Billing must remain disabled.');
  // The Management endpoint assigns its execution timestamp. Align only the
  // exact verified SQL to the already-reviewed repository version.
  if (applied.version !== version) {
    if (!/^\d{14}$/.test(applied.version)) throw new Error('Unexpected hosted migration version.');
    const changed = await api('/database/query', {query: `update supabase_migrations.schema_migrations set version='${version}' where version='${applied.version}' and name='${name}' and md5(array_to_string(statements,E'\\n'))='${expectedHash}' and not exists(select 1 from supabase_migrations.schema_migrations where version='${version}') returning version;`});
    if (changed.length !== 1 || changed[0].version !== version) throw new Error('Migration history could not be safely aligned.');
    after = await checkpoint();
    if (validateState(after)?.version !== version || after.provider_usage !== before.provider_usage) throw new Error('Final migration history verification failed.');
  }
  const result = {project, migration: name, version, checksum_verified: true, applied_now: !existing, private_tables_with_rls: 2, browser_billing_access: false, workers_paused: true, provider_usage: after.provider_usage};
  report(JSON.stringify(result));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  applyBillingStagingMigration().catch(error => { console.error(error.message); process.exitCode = 1; });
}
