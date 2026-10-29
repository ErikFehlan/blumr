# Closed production billing: activation package

Updated October 29, 2026 (UTC). Activation is **not authorized** by this package.
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
Merged application release: `14466c9c7c8bfe3bd06d187f3fe3cbdd95d91d4b`.
Post-merge closed runtime verification job `123754970050` in
[run 40960666446](https://github.com/ErikFehlan/blumr/actions/runs/40960666446)
passed against the deployed patch: eight migrations, nine bundles, 13 isolated
ledger tables, matching reconciliation credentials, provider usage 173, all
three workers paused and checkout disabled. All four required main workflows
passed. Public check job `123755056092` matched all 70 served files and passed
the browser navigation/sign-in probe. Cloudflare canonical deployment
`dc60c36c-65ea-44e3-829d-2229b8cd4890` serves that application release.
Later decision/evidence-only documentation commits do not change that deployed code.
The live configuration continuation started from main `100c047faf065f7e013713766358bdc0e2a5b6e8`.
PR #152 adds fail-closed tax readiness, tax-exclusive price validation and live
Checkout automatic tax with required customer billing address collection/save.
All four code workflows passed at `3972de1d605707f6ccfedd7e57d1438cd0086674`.
The three dependent billing functions were deployed with JWT settings retained;
all six dependency-file readbacks match that reviewed code. No migration changed.
See the deployment manifest for bundle hashes and backup/validation evidence.

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
| `STRIPE_AI_PLANS_ENABLED` | `false`; absence also fails closed |
| `STRIPE_TAX_REGISTRATIONS_VERIFIED` | `false`; absence also fails closed |
| Database AI pause | `true` |
| AI crons / billing cron | Inactive |
| Stripe webhook delivery | Inactive: no live destination created; exact configuration staged only |

Readiness changes independently gate live AI plan sales. Both explicit AI-sales
approval and enabled runtime provider calls are required before either AI tier
can mutate billing. That flag is not authorization to start AI workers or remove
the database pause. Those need their own release verification.

The worker entitlement adapter also preserves an unenrolled workspace member's
existing beta path only after the service confirms unmanaged subscription scope.
Held, inactive, expired, malformed or unavailable subscription checks cannot
use that fallback. Existing legacy access/budget checks still apply.

## Live Stripe configuration and exact remaining blockers

Authenticated live Dashboard access now works even though the connected API tool
still lists only the sandbox. The live business account was independently read:
legal company **BLUMRIO LLC**, operating in Columbus, Ohio, United States; charges,
payouts and details submission enabled; currently-due, past-due and pending
verification requirements empty. Formation state is not established by that
operating address. Private address, owner verification and financial details are
not retained here. No account or business verification fields were changed.

Live products, prices, portal configurations and webhook destinations were empty
before provisioning; no matching object was replaced or duplicated.

| Configuration | Verified result |
| --- | --- |
| Basic | Monthly USD 2900 cents; active product; 1000/0/0 allowances |
| Advanced | Monthly USD 7900 cents; product archived while AI is disabled; 1000/100/0 allowances |
| Pro | Monthly USD 15000 cents; product archived while AI is disabled; 1000/100/500 allowances |
| All three prices | Live, recurring monthly interval 1, licensed, per-unit, tax-exclusive |
| Tax category | All three products and default preset `txcd_10103001`, business-use SaaS; owner selected recruiting SaaS with AI as an included feature |
| Portal | Payment updates and invoice history enabled; cancel at period end; subscription changes disabled; public login link disabled |
| Support | Owner confirmed `erik@blumr.io`, monitored by Erik; saved as Stripe public support email |
| Production runtime | Live account, all three price IDs and portal configuration ID installed directly; AI-sales and tax-readiness flags explicitly false |
| Credentials | Existing reconciliation Vault/runtime credential preserved; live runtime key not yet created or installed |
| Webhook | No active endpoint/destination; exact 18-event snapshot configuration prepared with `2026-09-30.endive` |

No customers, subscriptions, charges, refunds, payment links or enrollments were
created. Product creation alone does not open application checkout. The portal
has no invented terms/privacy URLs; install approved public URLs after publication.

**Restricted runtime key:** The Dashboard form is ready for
`blumr-production-billing-runtime` with exactly eight permissions: Accounts read,
Charges/Refunds read, Invoices read, Prices read, Subscriptions read, Customers
write, Checkout Sessions write, Customer Portal write. Accounts read explicitly
covers `GET /v1/account`. No refund/dispute, payout, transfer, permission-management
or webhook write grants are included. Browser security rules require confirmation
at creation because this grants new persistent production access. No key value
has been generated, displayed, committed or logged. After confirmation transfer
it directly into production `STRIPE_SECRET_KEY`, verify the restricted live prefix,
account identity and required reads using the actual credential, and record only
redacted results/digests. Do not use the sandbox credential or a full-access key.

**Webhook creation constraint:** The Dashboard's final create form has the exact
URL/version/18 events but no disabled/draft creation control. The inspected v1 and
v2 creation schemas expose no initial disabled parameter. Do not create an enabled
endpoint and then disable it during this closed scope. Creation/signing-secret
installation therefore await a supported initially-inactive flow or the separate
webhook activation release. No signing secret exists to install yet. Required URL:
`https://zqiqjzxcpznhzjengfff.supabase.co/functions/v1/stripe-webhook`.

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

## Confirmed decisions and remaining inputs

| Decision | Concrete proposal / unresolved fact |
| --- | --- |
| Pilot | Owner selected the owner's existing verified ordinary business account for a future Basic pilot (one account). Canonical Auth UUID and beta eligibility were resolved privately; no identity is committed here. Enrollment and checkout activation are not approved by this selection. |
| First 24-hour operator | Owner confirmed Erik Fehlan using the existing administrator identity. Confirm the release window and GitHub failure notifications before activation. |
| Seller | Stripe legal entity verified as BLUMRIO LLC, operating in Columbus, Ohio, United States. Formation jurisdiction remains unconfirmed. |
| Support | Owner confirmed erik@blumr.io, monitored by Erik for billing and privacy; Stripe public contact saved. |
| Policies | Owner chose the seven-day initial-payment refund approach for the review draft; renewal requests individually reviewed. This is drafting direction, not approved publication/effective terms. Review [policy drafts](subscription-policy-drafts.md), confirm retention, processors and jurisdiction, then approve publication separately. |
| Tax | Owner confirmed no registrations yet, including outside Stripe. Stripe registrations are empty. Obtain the relevant registration/effective date and assess other business/customer locations and prior sales; do not infer no obligation. |
| Price presentation | Owner selected tax-exclusive USD prices with any required tax shown before payment. All three live prices are explicitly exclusive; registrations and calculation remain unresolved. |
| Password protection | Propose Supabase Pro plus enabling leaked-password protection. Alternative: explicit time-bounded acceptance of the Free-plan limitation with an owner and review date. No upgrade or risk acceptance is authorized. |

### Tax findings and integration work

Ohio operations are evidenced by the live business profile. Current Ohio rules
include business-use automatic data processing/electronic information services
within taxable sales; browser recruiting SaaS plausibly falls within this scope.
Confirm the legal tax treatment with the actual business facts and a qualified
adviser. This document does not declare a registration or exemption.

The owner confirmed **no actual registrations yet** and chose business SaaS for
all tiers. Stripe's canonical code `txcd_10103001` describes browser-delivered,
non-customized business software with no download. All products now use that code;
the old downloadable-software default was corrected. Prices and the default are
exclusive. These settings do not register the seller or start collecting tax.

Recommended next step: determine the appropriate Ohio vendor license using the
LLC's real operating facts, then apply through OH|Tax eServices or the appropriate
county auditor. Current Ohio guidance lists a $50 vendor-license fee. The owner
must supply/attest registration facts and authorize any filing/payment; no EIN,
bank data, private address or government credentials should be put in chat or the
repository. Record only jurisdiction, active status and effective date here after
verification. Review other physical locations, customer service locations and
prior sales separately; Ohio thresholds for remote sellers do not remove an Ohio
physical-presence obligation.

PR #152 implements live `automatic_tax[enabled]=true`, required billing address
collection and `customer_update[address]=auto`, behind the separate exact-true
`STRIPE_TAX_REGISTRATIONS_VERIFIED` gate. The deployed flag remains false. Missing,
false, uppercase or malformed acknowledgements fail before billing mutation.
Inclusive/unspecified live checkout prices are rejected. Sandbox behavior and
existing portal/reconciliation paths are unchanged. Thirty offline billing tests
passed, including address/tax parameters, recovery/idempotency and gate failures.
This is not a live jurisdiction calculation test. Before clearing the flag, verify
actual registrations, effective dates, category and an address-based calculation;
explain any zero-tax result. Opening acquisition remains separately approved.

Official sources checked October 29:
- https://tax.ohio.gov/business/ohio-business-taxes/sales-and-use/registration/
- https://tax.ohio.gov/business/sales-and-use-tax/sales-and-use-tax
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
($25 + roughly $20 compute - $10 credit). The authenticated Dashboard upgrade review now confirms **$25 charge today**
and a **$35 monthly invoice estimate** for this organization. This estimate can
change with usage, tax and add-ons; the Confirm upgrade button was not submitted.
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
4. Create/enable the approved signed webhook destination and install its signing
   secret directly into production. Verify its account/version/events and a
   signature/authentication probe without a charge, then activate reconciliation at five invocations
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
