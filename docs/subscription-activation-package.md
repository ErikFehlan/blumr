# Closed production billing: activation package

Prepared October 29, 2026. Activation is **not authorized** by this package.
The existing beta remains open. No account deletion, new signup requirement,
automatic conversion, enrollment or invitations are part of this release.

## Verified baseline and evidence

- Starting main: `872939c548894050ba3868b58bb1019b4108c474`; comparison showed no
  intervening commits. Cloudflare's canonical production deployment was
  `96702a01-4028-4a9f-95a1-471649725b5e` at the same commit.
- Fresh verification at 21:29 UTC checked eight installed migration hashes,
  nine deployed function hashes, all 13 billing ledger permission boundaries,
  closed runtime secret digests and matching Vault/runtime reconciliation digests.
  [Run 40954869096](https://github.com/ErikFehlan/blumr/actions/runs/40954869096),
  rerun job `123743810044`, passed. Public verification job `123743943187`
  matched 70 served files and passed navigation/sign-in-form checks.
- Production: 13 approved beta records; 12 matched verified, nondeleted,
  nonbanned Auth accounts; 15 active beta workspace plans; zero subscription
  accounts/customers/lifecycle receipts/risk receipts. All health counters zero.
- Provider usage remained 173. Database AI pause true. Both AI workers and
  `blumr-billing-reconcile` inactive. Reconciliation remains configured for five
  invocations per minute using Vault, without a literal credential in cron SQL.
- Full encrypted backup/isolated restore
  [40953103986](https://github.com/ErikFehlan/blumr/actions/runs/40953103986)
  is successful. Artifact `12930754838` was rechecked unexpired; it expires
  January 27, 2027. Recorded recovery includes all 160 stored documents.
- Security advisor totals remain 73 previously reviewed authenticated-definer
  notices, 34 RLS-without-policy notices and disabled leaked-password protection.
  This is not a claim that all application risks are resolved.

## Readiness patch

PR #150 adds the independent AI-sales gate and beta-preserving entitlement check.
All four required workflows passed at `c29e34b05748b35d2d2d73b0e995199b3bf1d910`.
Seven dependent functions were deployed at 2026-10-29T21:45:39.285Z with
their existing JWT settings retained. Full dependency readback matched reviewed
source. No migrations or runtime flags were reapplied. The updated deployment
manifest records the new hashes and the successful backup used for this patch.

## Closed controls to retain

| Control | Required state now |
| --- | --- |
| `STRIPE_BILLING_MODE` | `live` |
| `STRIPE_BILLING_LIVE_ENABLED` | `false` |
| `STRIPE_BILLING_SANDBOX_ENABLED` | `false` |
| `STRIPE_CHECKOUT_PAUSED` | `true` |
| `SUBSCRIPTION_FOUNDATION_ENABLED` | `false` |
| `STRIPE_LIVE_COHORT` | Empty |
| `AI_PROVIDER_CALLS_DISABLED` | `true` |
| `STRIPE_AI_PLANS_ENABLED` | Absent or `false`; absence fails closed |
| Database AI pause | `true` |
| AI crons / billing cron | Inactive |
| Stripe webhook delivery | Keep disabled; live provider-side state awaits connection |

Readiness changes independently gate live AI plan sales. Both explicit AI-sales
approval and enabled runtime provider calls are required before either AI tier
can mutate billing. That flag is not authorization to start AI workers or remove
the database pause. Those need their own release verification.

The worker entitlement adapter also preserves an unenrolled workspace member's
existing beta path only after the service confirms unmanaged subscription scope.
Held, inactive, expired, malformed or unavailable subscription checks cannot
use that fallback. Existing legacy access/budget checks still apply.

## Live Stripe completion blockers

Only the sandbox account is currently connected. The account-management flow
returned a connection URL. The owner reported connecting live, but two refreshed
account-list reads still exposed only the sandbox. The authorization must expose
the live account to this session before any live operation. No live identity, payment readiness, products, registrations,
portal or webhook is claimed as inspected or configured.

The current tool session has no usable local execution environment, no secure
Dashboard/browser session, and no exposed Supabase runtime-secret write or Stripe
restricted-key creation operation. API-key search did not reveal a key-creation
operation. Once live connection is complete, use a supported secure Dashboard or
credential-install workflow; never ask the owner to paste secrets into chat.
Do not expose a key through GitHub source, workflow inputs/logs or a public URL.

After connection:
1. Verify legal seller and live account identity, charges/payout readiness,
   outstanding requirements and supported currency. Warn before changing the
   execution context from sandbox to live.
2. List live products/prices/portal configurations/webhooks. Reuse exact matching
   blumr objects; do not guess IDs or repurpose another business's objects.
3. Verify monthly USD, interval count 1, licensed, per-unit prices:
   Basic 2900, Advanced 7900, Pro 15000 cents. Confirm price tax behavior before
   setting it: explicit inclusive/exclusive behavior cannot subsequently change.
4. Create a separate restricted live runtime key with Charges/Refunds read,
   Invoices read, Prices read, Subscriptions read, Customers write, Checkout
   Sessions write and Customer Portal write. No refund/dispute write privileges.
   Verify `GET /v1/account` with that actual key and expected account.
5. Portal: payment-method updates, invoice history and cancellation at period
   end enabled; subscription switching disabled. Use approved policy/support URLs.
6. Webhook URL:
   `https://zqiqjzxcpznhzjengfff.supabase.co/functions/v1/stripe-webhook`.
   Pin `2026-09-30.endive`; use the exact events below. Create/reuse it disabled.
   If the creation API cannot create disabled, use an appropriate disabled-destination
   flow rather than briefly enabling production delivery.
7. Transfer the restricted key and webhook signing secret directly to production
   runtime secrets; install nonsecret account/price/portal IDs there. Preserve all
   closed flags and existing reconciliation credentials. Verify only digests,
   modes, account identity and redacted object configuration. No charge/refund.

Required events, sourced from `_shared/stripe-billing.ts`:
```text
checkout.session.completed
checkout.session.expired
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
customer.subscription.paused
customer.subscription.resumed
customer.subscription.pending_update_applied
customer.subscription.pending_update_expired
invoice.paid
invoice.payment_failed
invoice.payment_action_required
invoice.finalization_failed
charge.refunded
charge.dispute.created
radar.early_fraud_warning.created
```

## Decisions awaiting the owner

| Decision | Concrete proposal / unresolved fact |
| --- | --- |
| Pilot | Owner selected the owner's existing verified ordinary business account for a future Basic pilot (one account). Canonical Auth UUID and beta eligibility were resolved privately; no identity is committed here. Enrollment and checkout activation are not approved by this selection. |
| First 24-hour operator | Propose Erik Fehlan using the existing administrator identity. Confirm availability and GitHub failure notifications before a release window. |
| Seller | Actual LLC legal name, formation jurisdiction and operating city/state/country remain unconfirmed. Employer and account display names are not legal-seller evidence. |
| Support | Confirm a monitored business support/privacy mailbox and who checks it. Existing in-app reports alone are insufficient for billing lockout support. |
| Policies | Owner chose the seven-day initial-payment refund approach for the review draft; renewal requests individually reviewed. This is drafting direction, not approved publication/effective terms. Review [policy drafts](subscription-policy-drafts.md), confirm retention, processors and jurisdiction, then approve publication separately. |
| Tax | Confirm actual registration records/effective dates, business locations, pilot customer service locations and prior sales by jurisdiction. Registration absence in Stripe is not evidence of no obligation. |
| Price presentation | Recommend tax-exclusive USD prices with tax shown before payment, or explicitly choose inclusive pricing. Neither is installed. |
| Password protection | Propose Supabase Pro plus enabling leaked-password protection. Alternative: explicit time-bounded acceptance of the Free-plan limitation with an owner and review date. No upgrade or risk acceptance is authorized. |

### Tax findings and integration work

Ohio is a jurisdiction to examine based on the owner's stated location, not a
confirmed LLC registration or tax conclusion. Current Ohio rules tax business-use
automatic data processing/electronic information services. blumr's browser-based
recruiting software plausibly falls in that area; a tax adviser must confirm the
classification and registrations using the actual business/customer facts.

Stripe's exact current product-code candidates:
- Basic: `txcd_10103001`, Software as a service (SaaS) - business use.
- Advanced/Pro: review whether the same SaaS category or `txcd_10105002`,
  Artificial Intelligence as a Service (AIaaS) - Cloud Based - Business Use,
  best describes the product. Do not assume that the AI tiers have identical tax
  classification merely because they share the application.

Current checkout creation does **not** set `automatic_tax[enabled]`, require a
billing address or save a newly supplied address back to the existing Stripe
customer. If the approved tax plan uses Stripe Tax, implement and test that flow
before acquisition, including a zero-tax result explained by registration and
location evidence. Adding a Stripe registration alone will not enable this
integration or register the LLC with an authority. Keep collection closed until
these facts and the implementation are resolved.

Official sources checked October 29:
- https://codes.ohio.gov/ohio-revised-code/section-5739.01
- https://codes.ohio.gov/ohio-administrative-code/rule-5703-9-46
- https://tax.ohio.gov/business/sales-and-use-tax/taxability
- https://docs.stripe.com/tax/tax-codes
- https://docs.stripe.com/tax/registering
- https://docs.stripe.com/tax/products-prices-tax-codes-tax-behavior
- https://docs.stripe.com/payments/checkout/taxes

### Password-protection cost

The connected organization reports Free, and the advisor confirms leaked-password
protection disabled. Both production and staging are active in that organization.
Official pricing starts Pro at $25/month with $10 monthly compute credit. With
both projects running on Nano/Micro-equivalent paid compute all month, budget
approximately $35/month before tax, excess usage or other add-ons
($25 + roughly $20 compute - $10 credit). This is a planning estimate, not an
account-specific invoice quote; verify the Dashboard total before purchase.
Nano projects carried into a paid organization are billed at the Micro rate.
Upgrading alone does not confirm the password setting is enabled.

Alternative acceptance must explicitly say that known-compromised-password
screening remains unavailable; existing authentication is not equivalent to that
protection. Do not reset accounts or require re-signup as part of either choice.

- https://supabase.com/pricing
- https://supabase.com/docs/guides/platform/manage-your-usage/compute
- https://supabase.com/docs/guides/auth/password-security

## Separate activation sequence — do not execute yet

1. Finish live account/key/catalog/portal/disabled-webhook verification; resolve
   seller/support/policy/tax/password choices and deploy any resulting checkout
   code. Obtain the explicit first-checkout decision and named operator/window.
   Preserve all required CI gates. The current closed-production validator is
   deliberately incompatible with active billing; prepare an approved active
   validation path before opening, rather than removing the checks afterward.
2. Refresh the verified cohort's Auth UUIDs, consent, email verification, beta
   eligibility and bans. Populate only the approved cohort, at most ten. Do not
   create manual subscriptions or convert the beta population.
3. With checkout paused and AI sales still blocked, enable subscription enforcement
   and live billing. Verify an unenrolled beta account keeps its existing path,
   a paid/held account cannot bypass enforcement, outsiders cannot check out,
   and account/mode checks succeed.
4. Enable signed webhook delivery, then activate reconciliation at five invocations
   per minute. Check actual HTTP results as well as cron execution. Run the
   health monitor; confirm zero backlog/error counters before acquisition.
5. Enable `BILLING_MONITOR_ENABLED=true` and confirm the operator receives Actions
   failures. Monitor both Stripe's rejected-delivery queue and the application's
   durable receipt queue. Pending age target is under 300 seconds.
6. Open **Basic only** for the approved cohort. No synthetic live charge.
   For each real, separately authorized subscription, verify the canonical paid
   invoice, a single paid period, 1000/0/0 allowances and portal cancellation.
   Watch every five minutes initially and at least hourly for the first 24 hours.
   Escalate any risk hold, delivery failure or reconciliation lag. Expansion
   and all paid AI activation remain separate decisions.

## Rollback

Before any subscriber exists: retain the current closed flags, empty cohort,
disabled webhook delivery and inactive billing/AI crons. Restore compatible
function source from the recorded release if needed. Never drop or replay the
installed migrations just to undo a function change.

After subscribers exist: immediately pause checkout and AI-plan acquisition.
Keep signed webhook intake, reconciliation, portal access and subscriber
enforcement working. Keep AI disabled where needed. Preserve all receipts,
holds, usage and paid-period history. Do not set foundation/live billing false
as a blanket rollback, because that can bypass enforcement or strand customers.

Use a compatible code revision that understands the current risk/ledger schema;
fix forward if no older revision does. For actual data loss, restore the verified
encrypted backup into an isolated environment, restore secrets separately,
validate stored documents/security/row checksums, reconcile canonical Stripe
state and retained events, then make an explicit cutover decision. Reopen checkout
only after the incident and release gates are resolved.
