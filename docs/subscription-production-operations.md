# Limited billing rollout: release candidate

This is the prepared operating procedure for PR #147, not authorization to deploy
or activate production. Paid AI remains disabled independently of billing.
The October 29 staging results are in `subscription-staging-results.md`.

## Configuration prepared for approval

Deploy the additive subscription migrations in repository order and the reviewed
billing, enforcement and frontend artifacts. Take a verified independent backup
first; keep acquisition closed throughout installation. Do not roll back by
removing ledger tables or replaying a schema dump into a running application.

| Setting | Production value / release input |
| --- | --- |
| Supabase project | `zqiqjzxcpznhzjengfff` |
| `BILLING_APP_URL` | `https://blumr.io/` |
| `STRIPE_BILLING_MODE` | `live` |
| `STRIPE_BILLING_SANDBOX_ENABLED` | `false` |
| `STRIPE_BILLING_LIVE_ENABLED` | Initially `false`; activation requires approval |
| `SUBSCRIPTION_FOUNDATION_ENABLED` | Initially `false`; enable enforcement before opening checkout |
| `STRIPE_CHECKOUT_PAUSED` | `true` until release checks pass |
| `STRIPE_LIVE_COHORT` | Empty initially; at most 10 explicit verified Auth UUIDs, comma-separated |
| `STRIPE_SECRET_KEY` | A separate restricted `rk_live_` secret, never the staging credential |
| `STRIPE_ACCOUNT_ID` | Verified live account ID; interactive and reconciliation handlers check `/v1/account` |
| Price IDs | Three distinct live monthly USD licensed prices, 2900/7900/15000 cents |
| `STRIPE_PORTAL_CONFIGURATION_ID` | Live portal with payment updates, invoice history, period-end cancellation; plan changes disabled |
| `STRIPE_WEBHOOK_SECRET` | Live endpoint's signing secret in the runtime secret store |
| `BILLING_RECONCILE_SECRET` | Separate random bearer in runtime and Vault, at least 32 characters |
| `AI_PROVIDER_CALLS_DISABLED` | `true` throughout this rollout |
| Database AI pause / AI crons | Paused; paid AI activation has a separate release gate |

Live credentials, catalog, endpoint, cohort membership and production changes are
not created by the staging runner. Before activation verify live mode and account
identity, exact price/portal settings, migration hashes, deployed source hashes,
permission boundaries and all four code CI workflows at the release commit.
Confirm GET `/v1/account` works with the restricted runtime key. Its required
object permissions are Charges and Refunds read, Invoices read, Prices read,
Subscriptions read, Customers write, Checkout Sessions write and Customer Portal
write. Refund/dispute writes are intentionally absent from the runtime key.

Subscribe the endpoint to the 15 lifecycle events in `eventTypes` plus all three
`riskEventTypes` exported by `_shared/stripe-billing.ts`; pin
`2026-09-30.endive`. Delivery to the wrong mode, Connect account, version or bad
signature fails. A valid delivery is acknowledged only after durable storage.

Before first live checkout, confirm the business's tax registrations and collection
policy, and check published subscription/cancellation/refund terms and the support
contact. Tax collection has not been enabled or assumed unnecessary. Stripe Tax
should only be enabled with the appropriate registrations and price tax behavior;
see https://docs.stripe.com/tax/registering. This commercial decision remains a
live activation input, not an inference from a passing sandbox payment.

## Worker capacity and monitoring

Initial limit: ten explicitly allowed accounts. The runtime rejects an oversized
or malformed cohort and refuses checkout for anyone outside it. Portal access and
reconciliation do not depend on cohort membership, so removing an account from the
list does not strand a subscriber.

Run five concurrent reconciliation invocations each minute. Each invocation
claims at most one risk receipt and one customer, with fenced leases and
`SKIP LOCKED`. Multiple receipts for one customer are reconciled together, up to
100 per claim. Fresh receipts bypass periodic polling delay; provider-error retry
backoff and active leases still apply. With ten customers this gives two waves plus retry headroom for a
five-minute reconciliation target. Staging validates this bounded cohort; it is
not evidence for a larger launch. Review capacity before expanding the limit.

Configure `blumr-billing-reconcile` using `pg_cron` and `pg_net`, with the bearer
looked up from Vault inside SQL. Keep it inactive until the production activation
step. The command is `net.http_post` to the fixed production billing-reconcile
URL, JSON body `{}`, timeout 60000, from `generate_series(1,5)`. Never put the
bearer itself in the stored cron command or logs. Check `cron.job_run_details` and
HTTP responses: a cron SQL success alone does not prove the HTTP job succeeded.

`.github/workflows/billing-health.yml` is prepared to check every five minutes
on `main`, gated by repository variable `BILLING_MONITOR_ENABLED=true`. It reads
aggregate service-only health, requires an active scheduler, and fails for:

- Oldest pending lifecycle/risk receipt at least 300 seconds old.
- Any worker/risk error, overdue customer, or unreviewed risk case.
- More than ten active subscriptions or an invalid health response.

The release operator owns failed Actions runs and the Stripe webhook delivery
queue during the first 24 hours. Verify their GitHub Actions failure notifications
before activation; no email/Slack destination has been invented or configured.
GitHub scheduled jobs can be delayed and are not a real-time paging service; keep
an operator watching the queue during the initial cohort rollout.
Check actual tier/allowance totals against the paid invoice for the first cohort.
A webhook rejected before enqueue is visible in Stripe's delivery queue, not the
application inbox; both must be monitored.

## Refunds, disputes and fraud review

A canonical charge → invoice payment → invoice → subscription → mapped customer
chain establishes ownership. Metadata cannot select an application user. Partial
and older-period refunds enter review without blocking. A full refund of the
subscription's latest invoice, a dispute or an early fraud warning holds new
evaluations. Previous results, periods and usage remain. Normal reconciliation
cannot clear the hold. These events never automatically issue a refund, cancel a
subscription or submit dispute evidence.

Inspect `blumr_billing_private.risk_cases` and `risk_events` using a trusted
operator connection. Browser users have no access. Review the actual Stripe
payment/dispute before deciding. Resolve with service RPC
`subscription_billing_risk_command('review', args)` where args contains:
`object`, `invoice`, current `revision`, unique UUID `request`, current app-admin
Auth UUID `actor`, `decision` (`allow` or `keep_hold`), and a 10–500-character
`reason`. The actor must be present in `app_admins` by canonical Auth email.
Concurrent/stale revisions return conflict. Repeating an identical request is
idempotent; every decision is append-only audited. A larger refund or newly
blocking event reopens the case. Do not use the synthetic staging operator in
production or directly edit `billing_hold`.

## Rollback and recovery

1. Set `STRIPE_CHECKOUT_PAUSED=true`; verify new checkout fails while portal,
   signed webhook intake, reconciliation and allowance enforcement continue.
2. Keep paid AI disabled. Retain all receipts and existing customer history.
3. Restore the last compatible function/frontend revision only. Do not deploy
   an old handler that drops risk events; its failing deliveries must remain
   pending for retry. Fix forward if the older revision cannot preserve holds.
4. For actual database loss, restore an encrypted verified backup into an isolated
   environment, verify row/security/sequence fingerprints, restore credentials
   separately, compare canonical Stripe state and replay retained events before
   any cutover. The billing drill intentionally restores ID-only external
   dependencies and excludes Auth credentials, documents and running schedulers;
   it complements the application's full independent backup procedure.
5. Reopen acquisition only after the incident is understood and the same gates
   pass. Broad shutdown of existing subscriber enforcement is not a rollback.

## Security review disposition

All 13 billing/allowance tables have RLS, no anonymous access and no authenticated
write privilege. Private billing service functions have fixed search paths; public
RPC wrappers are invokers, service-only. User authentication also checks the live
Auth session row, so signed-out JWTs cannot create checkout or portal sessions.
Credential-bearing redirects are refused and errors/logs omit provider bodies.
The independent backup inventory/security checks now include the private billing
and subscription schemas and their triggers/functions.

The staging advisor's 73 pre-existing authenticated definer notices and disabled
leaked-password-protection warning remain separate project findings. No new
billing browser-callable definer warning was introduced; service-only tables
intentionally have RLS without browser policies. Do not describe the entire app
as security-clean or accept those findings implicitly. Their existing review and
password-protection setting must be confirmed by the release owner before live
activation: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
and https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection.
