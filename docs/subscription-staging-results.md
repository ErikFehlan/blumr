# Hosted billing results — October 29, 2026

The core hosted billing lifecycle passed in Supabase `momfzjmycveqginxmqib` and
Stripe sandbox `acct_1UVYzGClb9pZVTfu`, using API version `2026-09-30.endive`.
This supersedes the pending tasks and runtime state in the earlier installation
checkpoint. Production remains unchanged; this is not production release approval.

Implementation/test head: `d79a2dec7972b237842e47e8a9be4faf3d95f54e`, draft PR #147.
Production `main`: `32854a0c3b64ffad4ca2846f775384c340c5d8bc`.

## Final state

- All four disposable subscriptions canceled in Stripe and the application;
  all four entitlements deny new evaluations with `subscription_inactive`.
- Four fixture accounts, six paid periods and 25 receipts retained for review;
  zero pending receipts, zero worker errors, zero real-user accounts.
- Billing/foundation flags false; billing cron and sandbox webhook disabled
  after cancellation reconciliation. No recurring test subscription remains.
- `AI_PROVIDER_CALLS_DISABLED=true`, database AI pause true, and both AI workers
  paused. The staging network guard remains deployed. Provider usage stayed at
  **8 rows**, unchanged; no paid AI calls were made.
- Existing secret stores retain the authorized restricted sandbox key and
  staging-only migration token. No credential values appear in source/evidence.
  Synthetic Auth users use `example.invalid`; creation sent no email and runner
  sessions were logged out. No real charges or real-user access grants occurred.

## Hosted tests

| Scenario | Result |
| --- | --- |
| Basic $29 checkout | Insufficient-funds attempt granted no account; successful retry created Basic with limits 1000/0/0 |
| Advanced $79 checkout | Advanced with limits 1000/100/0 |
| Pro $150 checkout | Pro with stored limits 1000/100/500; product still advertises rules and deep, not an additional shortlist pool |
| Retry and ownership | Same checkout session reused; conflicting tier/customer injection rejected; cross-user reads empty; service RPC denied |
| Allowance caps | Hosted transaction filled 1000 Basic rules, 100 Advanced shortlist and 500 Pro deep reservations; next rejected, failed reservation released capacity, unavailable lanes rejected. Transaction rolled back; no provider calls |
| Renewal | Historical clock advanced August 28 to September 29; paid September invoice created one new period |
| Failed renewal | October invoice unpaid; canonical `past_due`; access denied; no third period |
| Recovery | Portal selected successful test card; same October invoice paid; active Pro restored with one October 28–November 28 period |
| Period-end cancellation | Basic portal scheduled November 29 cancellation; existing paid access/period retained |
| Terminal cancellation | Four test subscriptions canceled without final invoice/proration; access denied, six periods retained |

Historical clock starts remained behind UTC wall time; the future-period guard
was not weakened. Terminal cancellation used immediate cancellation, not an
application clock advanced through the scheduled cancellation boundary.

Fixture marker: `billing_validation=20261029-v1`.

| Fixture | Customer | Canceled subscription |
| --- | --- | --- |
| Basic | `cus_VWz64PllM8UJOK` | `sub_1UVvGFClb9pZVTfug4KEVDg9` |
| Advanced | `cus_VWz66BRcOE4riC` | `sub_1UVvHXClb9pZVTfusYmrdHSj` |
| Pro | `cus_VWz6SGjriPGlEf` | `sub_1UVvJ1Clb9pZVTfu1Bh6qLa1` |
| Lifecycle Pro | `cus_VWzIFSxAUnfCza` | `sub_1UVvM7Clb9pZVTfuzu5UTDKV` |

Clock `clock_1UVvJQClb9pZVTfuZS1cHhtM`; lifecycle invoices
`in_1UVvM7Clb9pZVTfucqozgZvg` (initial),
`in_1UVvTHClb9pZVTfuWC6OHSWJ` (renewal),
`in_1UVvZGClb9pZVTfu7x2dItYS` (failed then recovered), all sandbox paid.

## Security and rollback

Hosted webhook tests rejected invalid/stale signatures, live mode, foreign
Connect accounts and wrong API versions. Identical signed deliveries yielded one
receipt; conflicting contents under one event ID returned 409. A signed fixture
with stale cancellation status and forged user metadata did not change canonical
ownership/paid state. User tokens cannot invoke the private worker. Canonical
Stripe reads drove all paid periods; no paid evidence was manually inserted.

Rollback with `STRIPE_CHECKOUT_PAUSED=true` returned 503 for all four checkout
attempts while portal and reconciliation continued. Paid state and the ledger
were preserved, excluding the operational admin revision incremented on reconcile.
The pause was restored afterward. This supplements the earlier maintenance-handler
deploy/restore drill; no database backup restore was performed.

Two defects were fixed/deployed with offline regression tests: checkout now pauses
independently of subscriber management; flexible portal cancellation is recognized
when `cancel_at` equals the item period end even if `cancel_at_period_end=false`.
Earlier custom timestamps are not classified as period-end cancellation.

Deployed source checkpoints: `billing-sandbox` version 17 from `f9efd1c`, bundle
`82a9a17264e557bf70375076932b0fc65bec93d79f2759d2114557d33d2eec97`;
`billing-reconcile` version 18 from `d79a2de`, bundle
`d27f35394ad17b0f4f9a3539974c951d1434fce5525b236ff953f3637fe4169b`.
Secret changes can increment versions without source changes. The unchanged
webhook handler and previously verified guarded AI handlers remain deployed.

Advisors rerun at 15:56 UTC: all ten subscription/billing tables have RLS; no new
browser-callable definer warning. Five expected
[no-policy notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
cover service-only tables. Existing project warnings remain: 73
[authenticated definer notices](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
and [leaked password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
This slice has only informational performance findings for foreign keys/unused
indexes, no performance warnings. The whole project is not declared security-clean.

## Evidence

The hosted runner pins staging/catalog/API version, authenticates marked fixtures,
rejects redirects, verifies AI locks/usage and logs out sessions. Validation and
setup jobs serialize through one concurrency group. Ordinary PR pushes cannot
reset active staging validation.

| Check | Successful Actions run |
| --- | --- |
| Three tiers | [40902537510](https://github.com/ErikFehlan/blumr/actions/runs/40902537510) |
| Webhook security | [40904050392](https://github.com/ErikFehlan/blumr/actions/runs/40904050392) |
| Checkout rollback | [40904050888](https://github.com/ErikFehlan/blumr/actions/runs/40904050888) |
| First renewal | [40904372422](https://github.com/ErikFehlan/blumr/actions/runs/40904372422) |
| Failed renewal | [40905337197](https://github.com/ErikFehlan/blumr/actions/runs/40905337197) |
| Recovery/all-tier verification | [40906318233](https://github.com/ErikFehlan/blumr/actions/runs/40906318233) |
| Terminal cancellation | [40906566806](https://github.com/ErikFehlan/blumr/actions/runs/40906566806) |
| Safe shutdown | [40906691260](https://github.com/ErikFehlan/blumr/actions/runs/40906691260) |

All four code CI workflows passed on `d79a2de`: app/browser `40904883229`,
subscription/PostgreSQL `40904883477`, criteria backend `40904883285`, rules
`40904883556`. Local billing suite: 19 network-denied Deno tests; runner boundaries:
3 Node tests. Earlier failed/canceled attempts are superseded by these runs; the
initial security assertion was corrected to exclude only operational admin revision.

## Remaining production release gates

1. Implement/validate refund, dispute and early fraud warning policy/handling:
   `charge.refunded`, `charge.dispute.created`, `radar.early_fraud_warning.created`.
   This adapter rejects live keys and is not a production billing adapter.
2. Complete the broader runbook's hosted outage/retry, checkout expiry/abandonment,
   signout-during-request, manual conversion and actual period-end expiry cases.
   Relevant offline/SQL/browser checks passed; these are not all separately hosted
   end-to-end tests. A full database restore drill is also separate.
3. Review existing security advisories and define cohort monitoring/worker capacity.
   Four synthetic users are not production load testing.
4. Prepare live configuration and a small rollout for separate approval. Start
   with checkout closed; verify migration parity and live catalog/webhook identity;
   name a limited cohort before activation. Pause new checkout for allowance
   mismatches, worker errors or excessive lag, retaining portal, webhook,
   reconciliation, enforcement and history for subscribers. Paid AI has its own gate.

No production secrets, live Stripe objects, production schema/runtime or
production deployment changed during this validation.
