# Billing staging checkpoint — October 29, 2026

Staging validation has started but has **not passed the release gate**. Production
has not changed. All work below targets Supabase project `momfzjmycveqginxmqib`
(`blumr-staging`) and Stripe sandbox `acct_1UVYzGClb9pZVTfu`.

## Database

| Repository migration | Hosted state |
| --- | --- |
| `20261028134006_subscription_foundation` | Applied; stored SQL matches repository |
| `20261028142020_subscription_screening_enforcement` | Applied; stored SQL matches repository |
| `20261028151317_subscription_feedback_usage` | Applied; stored SQL matches repository |
| `20261028155821_subscription_admin_grants` | Applied; stored SQL matches repository |
| `20261028174343_subscription_stripe_sandbox` | Applied; stored SQL matches repository |

The migration connector assigned execution timestamps to the applied records.
After comparing exact SQL lengths and MD5 checksums, history versions were aligned
to the repository filenames using guarded updates. The admin migration's original
version was `20261028203658`; its exact SQL MD5 is
`f93009578bafaf61d4fee52039f248ea`. No unapplied migration was marked applied.

The final billing migration was applied on October 29 at 10:44 a.m. EDT by the
[guarded staging run](https://github.com/ErikFehlan/blumr/actions/runs/40894500135)
on commit `372c1b0ac06bbf19501ccf6d236fdc95fb000d5b`. Its stored SQL MD5 is
`b575e919edfae10068cc4e76a2dd050c`, and its history version is the canonical
`20261028174343`. An independent database read verified all five migration hashes,
both private billing tables with RLS, and the service-only billing RPC boundary.

The earlier connector failed with `Invalid or expired requestState`. The first
Management migration request returned HTTP 403 because the existing shared
deployment token lacked Migrations permission. No schema write occurred through
either failed path. After explicit user confirmation, a separate token named
`blumr-staging-billing-migrations` was created for **blumr-staging only**, with
Database and Migrations read-write permissions and expiry on **November 5, 2026**.
It is stored as `SUPABASE_STAGING_MIGRATION_TOKEN` in GitHub's `criteria-backend`
environment. The shared deployment credential was not changed. Credential values
were not placed in chat, source, screenshots or logs.

The runner uses Supabase's Management migration endpoint, pins the reviewed SQL,
verifies all four prerequisites, requires zero subscribers and paused workers,
and uses stable idempotency. Database writes are limited to the checksum-guarded
history-version alignment after the migration endpoint applies the schema.
The write step uses only the dedicated secret. The explicit
`apply-billing-staging-migration` label triggered the verified run on PR #147 and
was removed afterward. Ordinary PR updates and the default CLI invocation remain
read-only; no production merge is needed to trigger this staging workflow.

After migration, subscription accounts, periods, billing customers and billing
events were all empty. All three AI/billing workers remained paused and provider
usage stayed at eight rows. The same run verified `AI_PROVIDER_CALLS_DISABLED=true`,
both feature flags false, and no installed Stripe server key.

## Deployed functions and AI lock

| Function | Verified source version | State |
| --- | --- | --- |
| `billing-sandbox` | 5 | Current billing implementation; feature disabled |
| `stripe-webhook` | 4 | Current billing implementation; feature disabled |
| `billing-reconcile` | 4 | Current billing implementation; private authentication required |
| `analyze-patterns-v2` | 472 | Subscription branch implementation plus AI network guard |
| `analyze-patterns-beta` | 479 | Subscription branch implementation plus AI network guard |
| `reassess-job` | 472 | Subscription branch implementation plus AI network guard |
| `refine-job-criteria` | 471 | Subscription branch implementation plus AI network guard |

Supabase increments function versions when runtime secrets are updated, even if
source is unchanged; the table records the source-verification checkpoint.

The guard is [billing-staging-guard.ts](../scripts/billing-staging-guard.ts). It is
included alongside each AI handler's entrypoint and imported before that handler.
It refuses any project other than staging, requires the deployed
`AI_PROVIDER_CALLS_DISABLED=true` lock, and permits fetch only to the staging Supabase HTTPS
origin with redirects rejected. It is deliberately not imported by billing
functions, which must eventually contact the Stripe sandbox.

Hosted checks caught that `Deno.env.set` is unsupported in the Edge runtime. The
guard was corrected to require the deployed lock without mutating the environment,
then all four handlers were redeployed and their exact source reverified.

The four AI handlers now match branch commit `acccfed` plus this guard. Every file
in their dependency bundles was retrieved and compared after deployment (34, 34,
33 and 17 files respectively). Foundation enforcement remains disabled. Do not
run the existing paid staging workflow during this billing validation: it could
replace guarded handlers, reactivate workers and make real provider calls.

`ancalagon-criteria-worker` and `ancalagon-job-reassessment` are paused. The
non-provider `blumr-direct-ai-cleanup` job remains active. Two pre-existing uncertain
AI attempts were preserved; no provider work was retried. Recorded provider usage
remained at eight rows throughout this checkpoint. Subscription accounts and
periods remain empty; no real or synthetic user access has been granted yet.

## Stripe and scheduler configuration

- Webhook endpoint: `we_1UVcpoClb9pZVTfu2SsTnj7W`, **disabled**, test mode only.
- Destination: `https://momfzjmycveqginxmqib.supabase.co/functions/v1/stripe-webhook`.
- Snapshot API version: `2026-09-30.endive`; the 15 event types match the handler.
- Signing secret stored encrypted in staging Vault as `billing_staging_webhook_secret`.
- Random 256-bit worker bearer stored encrypted as `billing_staging_reconcile_secret`.
- Cron job `blumr-billing-reconcile`: every minute, **inactive**. It reads the worker
  bearer from Vault at execution; its command does not contain a plaintext secret.
- Catalog and portal IDs remain in [stripe-sandbox-config.json](stripe-sandbox-config.json).

Vault storage does not automatically populate Edge Function environment variables.
The connected Supabase tools do not expose the runtime secret-setting operation,
and no Management API credential is available in this workspace. A configuration-only
[configuration step](../scripts/billing-staging-setup.mjs) uses the existing
`criteria-backend` deployment credential to transfer only the two named Vault
secrets and the fixed sandbox settings directly to staging. It cannot deploy,
migrate, activate billing or contact an AI provider. It rejects other projects,
live Stripe keys, existing subscribers and running workers. Hosted execution
[passed](https://github.com/ErikFehlan/blumr/actions/runs/40769897149): ten settings
are installed, including both Vault credentials and the exact staging frontend
URL. Both billing and foundation flags remain false; the AI disable flag is true.
The first run reached the secret-setting API but mishandled its empty HTTP 201
response; response handling was corrected before successful verification.

Stripe's connector does not issue a restricted server API key. The workflow can
install a sandbox key from the optional `STRIPE_BILLING_SANDBOX_KEY` environment
secret; otherwise it preserves any existing runtime key and reports only whether
one is present. The successful run confirmed **no Stripe server key is installed**.
It never logs credential values. Runtime activation remains pending.

The October 29 setup run again confirmed that no Stripe key is installed. The
Stripe connector exposes no API-key creation operation. Its dashboard is now
authenticated in the correct sandbox, and a six-permission restricted key is
prepared for final confirmation. GitHub is also authenticated and its destination
secret form is prepared. No key has been created or copied.

Complete the final migration before activation. Configure the variables listed in
[the sandbox runbook](subscription-stripe-sandbox.md#hosted-staging-setup) through
Supabase's secure secret store. Prefer a staging-only `rk_test_` key, granting only
the customer/Checkout/portal writes and customer/price/subscription/invoice/portal
reads used by the adapter. Add it as `STRIPE_BILLING_SANDBOX_KEY` in the GitHub
`criteria-backend` environment secret store, then rerun the configuration job to
transfer it as `STRIPE_SECRET_KEY`. The two existing Vault secrets have already
been transferred without logging them. Keep `AI_PROVIDER_CALLS_DISABLED=true`. Verify configuration before
enabling the webhook or cron. Do not paste keys into chat, repository files or logs.

## Checks completed

- Hosted billing status: HTTP 200 with `enabled:false`.
- Hosted checkout: HTTP 404 while disabled.
- Hosted webhook: HTTP 404 while disabled.
- Hosted reconciliation: HTTP 401 without its private credential.
- Guarded criteria/reassessment handlers: HTTP 401 without worker credentials.
  Both analysis handlers boot successfully and reject a public-key-only request
  for a nonexistent workspace with HTTP 403; no user session was impersonated.
- Checkout rollback rehearsal: deployed maintenance handler, observed HTTP 503,
  restored the billing handler, observed HTTP 200 with `enabled:false`. Webhook,
  scheduler, ledger and AI lock were preserved. This was a handler rollback drill,
  not a paid-subscription recovery or database restore rehearsal.
- 45 network-denied Deno tests passed across billing, the staging guard, tier
  routing, workers, screening, feedback, offline and security boundaries.
  Restricted sandbox keys are accepted; live restricted keys are rejected before
  network access. Checkout uses a fixed integration identifier across retries.
- Four configuration tests cover project/key isolation, secret transfer and
  redaction, and refusal to mutate active subscription/worker state.
- Five additional migration-runner tests verify project/source isolation,
  prerequisite checks, idempotency, recovery from a lost response and read-only mode.
- Security advisors rerun after the final migration: all ten subscription/billing
  tables have RLS; zero exposed subscription definer functions are executable by
  browser roles. Browser roles cannot use the private billing schema or execute
  `subscription_billing_command`; the public wrapper is security-invoker and
  executable by service_role. Five informational no-policy notices are expected
  for service-only output/reservation/audit/customer/event tables.
  [No-policy guidance](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
- Existing project advisories remain: 73 authenticated definer notices and leaked
  password protection warning. They predate these changes; the whole project has
  not been declared security-clean. [Definer guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
- Performance advisors: new informational missing-FK-index notices for plan-code
  and current-period references, plus unused new indexes. The catalog is immutable
  and small; current-period lookup has the account primary key. Reassess with
  staging workload evidence before adding redundant indexes. The post-migration
  run also reports the unused pending-billing-events index, expected before any
  sandbox events are received; no subscription/billing performance warnings.
- All five CI workflows passed on commit `372c1b0`, including application/browser
  journeys, subscription/PostgreSQL, criteria backend, rules screening, and the
  disabled staging configuration. The explicit migration run also passed all
  nine setup/migration safety tests and its apply-and-verify step.

## Still required before production consideration

1. Supply the missing restricted sandbox key through the secure environment store,
   rerun the configuration-only job, and verify the stable API contract before activation.
2. Enable the sandbox webhook and worker, then use disposable verified users for
   real hosted Checkout → test payment → webhook → correct plan/allowances.
3. Verify all tiers, renewals, failed payments/recovery, period-end cancellation,
   duplicate/out-of-order receipts, expiry and temporary outages. Align test-clock
   scenarios with application time; never weaken the future-period guard.
4. Repeat advisors after hosted lifecycle tests, verify no added provider usage,
   rehearse recovery with paid test subscriptions, and clean up synthetic fixtures.

Do not drop billing tables or erase usage to roll back. After accepting any test
subscription, retain webhook/reconciliation processing during a checkout shutdown
so cancellations and payment state can still settle. Production remains a separate
approval after the complete staging evidence passes.
