# Stripe sandbox integration

This slice adds hosted Checkout, a payment/invoice/cancellation portal, a durable
webhook inbox and a private reconciliation worker to the subscription ledger.
It is disabled by default. No migration, function deployment, schedule, Stripe
product, customer, payment or account grant is created by deploying the frontend.
All subscription migrations remain outside release scripts.

## Contract

- Basic $29, Advanced $79, Pro $150 USD monthly, quantity one, per user across
  workspaces. Pro advertises 1,000 rules and 500 deep evaluations, without an
  additional shortlist pool. No trials, coupons, taxes or add-ons are configured.
- Verified Auth and beta approval precede checkout. The browser supplies only a
  tier. Customer, price and return URLs are server-owned. Existing customers can
  still manage billing if beta approval is revoked.
- Persistent customer/checkout operations use stable Stripe idempotency keys.
  A customer lease serializes checkout and reconciliation. Open checkout resumes;
  a lost-response retry keeps the exact parameters/expiry. An ambiguous operation
  older than 23 hours requires operator recovery, avoiding duplicate creation
  after Stripe's idempotency retention window. Only a verified expired session
  can be replaced. Completed sessions wait for verified subscription state.
- Webhooks verify the raw UTF-8 body, HMAC-SHA256, `v1`, five-minute freshness,
  optional secret rotation, sandbox mode and pinned API version. Acknowledgment
  follows persistence of event ID, customer ID, type and body hash. Full payloads
  and customer metadata are neither stored nor trusted for user identity.
- The worker retrieves canonical customer, subscription and invoice state;
  duplicate/out-of-order events do not replay old tiers. A paid invoice must match
  the subscription, item, price and full period. Redirects never grant access.
  Live objects, multiple nonterminal subscriptions, unknown prices and unsupported
  billing shapes stop for review. Transient failures retain receipts.
- Manual-to-paid conversion preserves historical usage. Same-period updates and
  payment recovery preserve reservations and usage. Renewal creates a new period.
  Past-due/unpaid/paused/canceled paid accounts cannot start new evaluations.
- Portal configuration must enable invoices, payment methods and end-of-period
  cancellation, and disable plan switching. Scheduled cancellation retains paid
  access until period end. Upgrade/proration, downgrade scheduling, add-ons,
  taxes and refund/dispute policy remain separate work.
- Deletion is blocked before Storage/Auth cleanup while billing is leased, a
  checkout is pending or a subscription is nonterminal. Cancel, let the paid
  period end, and reconcile before deletion. Resolve ambiguous checkout first.

## Verified Stripe sandbox setup — October 28, 2026

The connected `blumr.io sandbox` account was verified as test mode. Its initially
empty catalog now contains the three monthly prices and a portal configuration
matching the contract above. Nonsecret IDs are recorded in
[stripe-sandbox-config.json](stripe-sandbox-config.json).

A synthetic customer without an email used Stripe's `pm_card_visa` test method.
Basic produced a paid $29 test invoice and an active subscription; the subscription
was then canceled with no proration or final invoice. A portal session opened on
`billing.stripe.com`, and a card-only hosted Checkout Session was created on
`checkout.stripe.com` with a 31-minute automatic expiry. Checkout was not paid.
No real charges, customer emails, application grants or hosted deployments occurred.

The actual paid invoice/item/price snapshot is retained as a synthetic regression
fixture and passes the adapter's canonical reconciliation logic with network access
denied. Current Checkout creation uses `allowed_payment_method_types`, not the
removed writable `payment_method_types`, and explicitly uses flexible billing.
The connector describes the preview API schema; these API smoke checks do not
replace a full application round trip against the pinned stable API version.

Smoke evidence: customer `cus_VWee8yRTH5TsSh`, canceled subscription
`sub_1UVbLGClb9pZVTfugvZCBlyo`, paid test invoice
`in_1UVbLGClb9pZVTfury4fUbzn`. No webhook destination or reconciliation schedule
has been registered. Hosted staging, secrets and full end-to-end verification
remain the next release step.

## Hosted staging setup — not executed by this branch

Use the existing staging project, synthetic verified beta-approved users and a
separate Stripe sandbox. Apply preceding subscription migrations in order, then
`20261028174343_subscription_stripe_sandbox.sql`. Rehearse migration parity and
run Supabase security/performance advisors before enabling the feature.

Reuse the recorded sandbox prices. The created portal configuration uses `subscription_update.enabled=false`,
`subscription_cancel.enabled=true`, `subscription_cancel.mode=at_period_end`,
`invoice_history.enabled=true`, and `payment_method_update.enabled=true`.

Configure these through the deployment secret store; never put keys in frontend
code, tracked files, tool output or PR comments:

| Variable | Value |
| --- | --- |
| `STRIPE_BILLING_SANDBOX_ENABLED` | `true` only in the isolated test environment |
| `SUBSCRIPTION_FOUNDATION_ENABLED` | `true` after staging admission checks; otherwise off |
| `AI_PROVIDER_CALLS_DISABLED` | `true` throughout billing tests |
| `STRIPE_SECRET_KEY` | Sandbox secret beginning `sk_test_`; live keys are rejected |
| `STRIPE_PRICE_BASIC`, `STRIPE_PRICE_ADVANCED`, `STRIPE_PRICE_PRO` | Three distinct sandbox Price IDs |
| `STRIPE_PORTAL_CONFIGURATION_ID` | Checked sandbox portal configuration ID |
| `BILLING_APP_URL` | Exact HTTPS app URL, without query or fragment |
| `STRIPE_WEBHOOK_SECRET` | Endpoint signing secret |
| `STRIPE_WEBHOOK_SECRET_PREVIOUS` | Optional previous secret during rotation |
| `BILLING_RECONCILE_SECRET` | Random private worker credential, at least 32 characters |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Standard Edge runtime credentials |

Deploy `billing-sandbox`, `stripe-webhook` and `billing-reconcile` only to staging.
Gateway JWT checks are intentionally disabled: the interactive handler verifies
Auth, the webhook verifies Stripe signatures, and the worker checks its private
bearer credential before API access.

REST requests pin **2026-09-30.endive**; independently configure the webhook
endpoint to the same snapshot event version. Native fetch and Web Crypto avoid
unpinned remote SDK imports. Periods use subscription items, and invoice proof
uses current parent/pricing fields. Register the event types in
`_shared/stripe-billing.ts`'s `eventTypes` set.

Schedule a private POST to `billing-reconcile` at least once per minute, storing
its bearer in the scheduler's secret store. No schedule is installed here. One
invocation processes one customer; parallel workers use `SKIP LOCKED`. Pending
receipts and mapped subscriptions are polled with five-minute backoff; failures
retry after one minute. Increase throughput for the intended cohort before
release. The return URL opens Settings after verified status loads; the user
refreshes to see the confirmed plan, with no optimistic access grant.

## Recovery and evidence

Service-only inspection of `blumr_billing_private.customers` and `events` exposes
pending receipt age, unmapped customers, `last_error`, lease expiry and lag.
Failed workers return HTTP 503. Three-minute leases fence expired workers; events
arriving during a fetch remain pending for the next run.

For old ambiguous creation, inspect Stripe using the persisted provision/checkout
identity and idempotency key. Confirm the original object or its absence before
controlled repair; never clear identity solely because local expiry passed.
Subscription metadata contains the opaque checkout operation ID, so canonical
subscription reconciliation can recover a lost session save. Multiple or foreign
subscriptions require investigation.

Before staging approval, run actual sandbox round trips for all tiers, checkout
cancel/expiry, payment failure/recovery, duplicate/out-of-order webhooks, temporary
outages, period-end cancellation, invoices/payment methods, signout during a
request and manual conversion. Verify allowances and saved history each time.
Stripe test clocks can move ahead of wall time; application entitlements still
use UTC wall time and reject periods over five minutes in the future. Renewal
clock tests need a time-aligned environment; do not relax that guard for tests.

Network-denied Deno tests cover auth, signatures, replay and paid evidence. SQL
checks cover privacy, deduplication, conversions, renewal/recovery, leases and
deletion. Browser checks cover disabled visibility, mobile, safe navigation and
session isolation. PostgreSQL 17 CI adds concurrent checkout claims/replays,
competing workers and reservations alongside paid plan changes. These simulations
are not an actual Stripe sandbox or hosted Supabase advisor run.

Rollback must stop new checkout and pause subscribed dispatch while retaining
portal cancellation, reconciliation, pending receipts and ledger history. Do not
disable the allowance gate for paying users or abandon recurring subscriptions.

Official references checked October 28, 2026:

- https://docs.stripe.com/api/versioning
- https://docs.stripe.com/api/checkout/sessions/create
- https://docs.stripe.com/api/billing_portal/configurations/create
- https://docs.stripe.com/api/subscriptions/object
- https://docs.stripe.com/api/invoices/object
- https://docs.stripe.com/api/invoice-line-item/object
- https://docs.stripe.com/webhooks
