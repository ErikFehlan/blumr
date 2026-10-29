# Billing readiness results — October 29, 2026

The billing implementation and staging readiness checks passed in Supabase
`momfzjmycveqginxmqib` and Stripe sandbox `acct_1UVYzGClb9pZVTfu`, pinned to
`2026-09-30.endive`. This supersedes earlier installation and lifecycle checkpoints.
This section describes the staging checkpoint before production installation.
PR #147 was subsequently merged and the closed production release installed;
see [production operations](subscription-production-operations.md) and the
[current activation package](subscription-activation-package.md). Live checkout
and paid AI still require separate decisions.

Hosted billing/recovery checkpoint: `a1eacbbe91435ed19621d686a36d896fd139ea32`.
The final PR also applies the verified fixed-collation checksum ordering to the
shared application backup inventory, with a native PostgreSQL regression test;
the final commit and CI status are recorded in PR #147.

## Final staging state

- All eight disposable subscriptions canceled in Stripe and the application.
  Eight accounts, eleven periods (ten paid and one historical manual), 93 lifecycle
  receipts (including synthetic replay/load fixtures), four risk receipts, three risk
  cases and four review audit records are
  retained. No pending receipts, worker/risk errors, unreviewed cases or active
  subscriptions remain. No real-user accounts were granted access.
- Billing/foundation flags false; billing cron and sandbox webhook disabled after
  cancellation reconciliation. The cron retains its tested five-calls-per-minute
  command with a Vault lookup, never a literal bearer.
- `AI_PROVIDER_CALLS_DISABLED=true`, database AI pause true, both AI workers paused.
  The staging network guard remains deployed. Provider usage stayed at **8 rows**;
  no paid AI calls were made.
- Authorized sandbox credentials remain in secret stores. The restricted key has
  Charges and Refunds read in addition to its original billing permissions; it has
  no refund/dispute write permission. Actual restricted-key charge and invoice
  payment reads passed. Synthetic Auth users use `example.invalid`, creation sent
  no email and runner sessions were logged out. No temporary test admin remains.

## Hosted behavior

| Scenario | Verified result |
| --- | --- |
| Basic $29 checkout | Failed initial payment granted no account; successful retry gave limits 1000/0/0 |
| Advanced $79 / Pro $150 | Limits 1000/100/0 and 1000/100/500 respectively; Pro UI advertises rules and deep, without an additional shortlist pool |
| Ownership, retries, caps | Same checkout resumed; tier/customer injection and cross-user access rejected; hosted cap exhaustion and release worked without AI calls |
| Renewal and failed renewal | One new paid period on renewal; unpaid next invoice paused access without creating a period |
| Payment recovery | Portal updated the payment method; payment of the same invoice restored access without resetting usage |
| Checkout expiry/abandonment | Abandonment granted no account or period; expiration allowed a fresh session; repeated request reused the existing session |
| Revoked authentication | After actual signout, the previously valid JWT could create neither checkout nor portal session (401) |
| Provider outage | Invalid runtime credential made the worker fail; receipt and ledger were preserved; restoring the credential allowed retry |
| Manual-to-paid conversion | New paid period retained the previous manual period and usage; the old successful result remained cached without another allowance charge |
| Period-end cancellation | A historical Stripe clock crossed the scheduled boundary; Stripe and the app became canceled while retaining the paid period |
| Partial/full refund | Actual $10 partial refund created review without a hold; the remaining $140 refund increased the case revision and held access |
| Dispute / early fraud warning | Actual Stripe test payment events created canonical hold cases; held access was denied |
| Operator review | Release restored access, duplicate review was idempotent, and renewed hold persisted with append-only audit; transaction-scoped synthetic admin was removed |
| Capacity | 50 receipts across eight mapped customers, five parallel workers, 4.327 seconds; no duplicate periods or pending receipts |
| Scheduler | Five invocations per minute; final cycle at 18:29 UTC returned five HTTP 200 responses, each with zero failures |
| Receipt priority | New receipts bypass the normal poll timer; active leases and provider-error retry backoff still apply, verified in hosted SQL and native CI |

Historical clocks remained behind UTC wall time; the future-period guard was not
weakened. Scheduled cancellation used `clock_1UVxKuClb9pZVTfuwxQiIsaG`, August 28
through September 29, and subscription `sub_1UVxNmClb9pZVTfuXy3UYDju`.
Fixture marker throughout: `billing_validation=20261029-v1`.

Actual risk events retained for review:

- Refund: `evt_3UVvZJClb9pZVTfu1QC7mjhH` (partial),
  `evt_3UVvZJClb9pZVTfu19TtY3j5` (full), charge `ch_3UVvZJClb9pZVTfu1mjE8b5s`.
- Dispute: `evt_1UVxNdClb9pZVTfu8hK899Tp`, dispute `du_1UVxNcClb9pZVTfuyJX7QGYd`.
- Fraud warning: `evt_1UVxNjClb9pZVTfuBipLZZ5F`, `issfr_1UVxNiClb9pZVTfuzsleCOTP`.

The dispute test found a real `du_` ID prefix that the earlier `dp_` validator
rejected. The fix accepts canonical IDs; Stripe redelivery returned 200 and the
worker created the hold. The failed attempts were not acknowledged or lost.
The scheduled-worker drill also found fresh receipts waiting behind periodic
polling. Migration `20261029180352_subscription_billing_receipt_priority.sql`
fixes this without bypassing error backoff. One concurrent verification attempt
was interrupted and later retried; the final hosted regression and scheduler
cycle passed. Earlier failed attempts are retained as history, not pass evidence.

## Security and guarded live configuration

Raw signatures, timestamp freshness, exact API version, mode and Connect account
checks precede durable enqueue. Duplicate delivery is idempotent; conflicting
payloads under an event ID fail. Canonical Stripe payment ownership drives access,
never webhook metadata or browser redirects. Credential-bearing HTTP redirects
are refused; runtime errors omit provider bodies. The runtime checks the live
Auth session row as well as the verified user.

Live mode requires the exact production project/origin, a separate restricted
live key, expected Stripe account identity and explicit activation. Checkout
requires an explicit cohort of at most ten Auth UUIDs; empty/malformed/oversized
cohorts fail closed. Removing cohort membership does not remove portal access.
Offline tests cover successful guarded live checkout, outsider denial, account
mismatch, mode mismatch and subscriber management. No live network payment or
production configuration was performed.

Advisors rerun at 18:29 UTC: all 13 billing/allowance tables have RLS, no anonymous
privileges and no authenticated writes. Eight informational
[no-policy notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
are intentional service-only tables. Private billing functions use fixed search
paths and service-only invocation; browser-facing risk writes do not exist.
There are no new billing authenticated-definer warnings. The existing 73
[authenticated-definer notices](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
and disabled [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
remain project-level release review items. Passing billing checks does not resolve
or implicitly accept them.

Staging shared source matches the repository. The tested source bundle hashes are:

| Handler | Bundle SHA-256 |
| --- | --- |
| billing-sandbox | `a4763a9cca5cabf9b0a0a8a6c6b65cc6d5966aed5b19164c428176ac8dc7ba24` |
| billing-reconcile | `dbdf36d0183a82c615bb40d4a752a8e21e1bb5779ae58475081f80a8a71043d4` |
| stripe-webhook | `6f129298a5966cbd0925292e5c2017da10c2189a736532f04e4f449df74af22f` |

Secret changes can increment function versions without changing source. All seven
subscription migrations are installed in staging, with readiness/priority source
checksums verified by the runner.

## Rollback, recovery and monitoring

The checkout-pause rehearsal returned 503 for acquisition while portal,
reconciliation, subscriber enforcement and history continued. A previous
maintenance-handler deployment/restore rehearsal also passed. Rollback never
requires dropping the ledger or clearing usage.

The encrypted billing recovery drill restores all 13 tables into disposable
PostgreSQL 17 with Docker networking disabled. It compares exact rows, constraints,
indexes, RLS policies, grants, function bodies/settings, triggers and sequence
state/privileges, verifies encryption/decryption and confirms the source did not
change. Comparison uses a fixed collation so differently configured databases cannot
reorder rows during verification; failure output withholds private row contents.
Only encrypted data, the key envelope and aggregate verification are
retained; plaintext and the isolated database are removed. External Auth/workspace/
candidate dependencies are inert ID-only stubs. This is a billing-ledger recovery
drill, not a claim that Auth credentials or application documents were restored.
The separate full application backup must still be verified before a live release.

Health monitoring and its scheduled Actions workflow are prepared, disabled until
release. Thresholds fail closed for five-minute receipt lag, errors, overdue
customers, unresolved risk and more than ten subscribers. A release operator and
failure-notification verification are required; scheduled Actions alone are not
real-time paging. Details are in the production operations guide.

## Evidence

| Check | Successful Actions run |
| --- | --- |
| Three tiers | [40902537510](https://github.com/ErikFehlan/blumr/actions/runs/40902537510) |
| Webhook security | [40904050392](https://github.com/ErikFehlan/blumr/actions/runs/40904050392) |
| Checkout rollback | [40904050888](https://github.com/ErikFehlan/blumr/actions/runs/40904050888) |
| Renewal / failed renewal | [40904372422](https://github.com/ErikFehlan/blumr/actions/runs/40904372422) / [40905337197](https://github.com/ErikFehlan/blumr/actions/runs/40905337197) |
| Recovery and all-tier verification | [40906318233](https://github.com/ErikFehlan/blumr/actions/runs/40906318233) |
| Expiry, signout and provider outage | [40923779963](https://github.com/ErikFehlan/blumr/actions/runs/40923779963) |
| Risk review, manual conversion, scheduled expiry | [40926628656](https://github.com/ErikFehlan/blumr/actions/runs/40926628656) |
| Bounded capacity | [40925232409](https://github.com/ErikFehlan/blumr/actions/runs/40925232409) |
| Restricted risk permissions | [40926925940](https://github.com/ErikFehlan/blumr/actions/runs/40926925940) |
| Final encrypted recovery | [40931741798](https://github.com/ErikFehlan/blumr/actions/runs/40931741798) |
| Final safe shutdown | [40931281614](https://github.com/ErikFehlan/blumr/actions/runs/40931281614) |

The final encrypted restore recovered **137 rows across 13 tables in 11 seconds**,
with exact rows/security/sequence comparison and networking disabled. The
[encrypted recovery artifact](https://github.com/ErikFehlan/blumr/actions/runs/40931741798/artifacts/12922702955)
is retained until November 28; renew recovery evidence before relying on it later.
Aggregate health verification: [40931917244](https://github.com/ErikFehlan/blumr/actions/runs/40931917244).
Local billing tests: 25 Deno tests with network denied; 15 Node runner/monitor tests.
Native PostgreSQL CI includes receipt priority, retry backoff, risk holds, audit
replay, revoked sessions and concurrent allowance reservations. All four code
workflows must pass at the release commit, including app/browser and backup
security checks. Production deployment jobs remain gated and skipped on this PR.

## Remaining live activation inputs

The billing engineering gaps above are implemented and staging-validated. Release
still requires separate approval and concrete live configuration: restricted live
key/catalog/webhook/portal, named cohort, migration parity, a current independent
application backup, an operating/notification owner, commercial tax/terms/support
checks and disposition of the existing security findings. No tax requirement has
been assumed away. Paid AI remains disabled and has its own activation gate.
