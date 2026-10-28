# Three-tier subscriptions

Audit date: October 28, 2026. Source baseline: `32854a0` on main.
Tracking: [#142](https://github.com/ErikFehlan/blumr/issues/142).

This is an initial development slice, not a release-ready billing system. No
production pricing, billing, database, worker configuration or deployment changes
are authorized by this branch. The new migration is deliberately absent from
deployment scripts. `SUBSCRIPTION_FOUNDATION_ENABLED` defaults off and must remain
off outside local tests until M1/M2 integration and staging checks are complete.

## Audit and reuse

| Area | Evidence in existing code | Decision |
| --- | --- | --- |
| Authentication and tenancy | `assets/auth.js`, workspace membership RLS, authenticated analysis handler | Retain; derive actor from verified JWT or durable task attribution, never request JSON. |
| Existing plans | `20260928130000_phase3_team_plans.sql`, beta/pilot grants and backer seat controls | Keep intact. These are workspace access and provider-call controls, not completed candidate allowances. |
| Resume intake | `assets/bulk-files.js`, `assets/bulk-screening.js`, unified resume migration | Reuse PDF/DOCX/TXT/OCR/ZIP ingestion, deduplication, candidate/document persistence and unified Analyze action. |
| Rules and evidence | `_shared/job-intelligence.mjs`, `screening-engine.mjs`, `screening-requirements.mjs`, cache and bulk migrations | Reuse one engine, source-bound requirements, equivalents, approved manager evidence, ranking, near-miss review and source/version invalidation. #118/#119 are already released. |
| Job priorities | `refine-job-criteria/code-first.mjs`, `drafts.ts`, `generate.ts`, existing editable priority UI | Reuse deterministic extraction and draft persistence. Basic must never fall back to AI when extraction is weak; retain source text and request recruiter review. |
| AI | Shared `reserveModelCall`, model routing, direct request idempotency and durable assessment leases | Reuse. Add subscription checks before provider admission; do not create a second AI engine. |
| Background attribution | Criteria and reassessment tasks have `usage_actor_id`, but some reservations pass `null` | Must propagate the durable actor; never assume the workspace owner paid for work initiated by another seat. |
| Automatic deep work | `auto_start_resume_analysis` and finalist selection/worker fences | Requires plan-aware selection and atomic allowance reservations. Current automatic behavior is not a subscription gate. |
| Costs and usage | Provider metadata, budget counters, product usage events and screening charges | Retain provider-cost protection separately from customer allowances. Coordinate unmerged #117; never reset counters to implement subscription renewal. |
| Candidate visibility | #134/#135/#140/#141 on audited main | Preserve recent deduplication, legacy-job and full-list fixes; regression-test single and bulk flows. |
| Billing | No Stripe/checkout/webhook implementation in audited source | Build new provider adapter, webhook inbox/reconciliation and settings/pricing UI. |
| In-flight work | #132 backend budgets, #133 parity baseline, #125 measurement | Reconcile against current main; do not merge or duplicate their work implicitly. |

The live production audit queried schema metadata only. Staging table inventory
and production columns confirm existing workspace plans, worker attribution and
unified upload fields. No candidate data or credentials were copied into this
document; runtime parity beyond those schema checks is not claimed.

## Milestones and implementation sequence

1. **M1 — Foundation, [#143](https://github.com/ErikFehlan/blumr/issues/143).**
   Versioned plan catalog; individual subscription accounts; explicit allowance
   periods; atomic reserve/settle/release; scoped reads and service-only mutations.
   Then wire durable actor attribution, result commits and all admission paths.
2. **M2 — Unified tier routing, [#144](https://github.com/ErikFehlan/blumr/issues/144).**
   Complete Basic job setup, parsing, rules, reporting and feedback without AI.
   Advanced runs AI only on server-verified finalists. Pro queues deep work for
   each eligible candidate, up to 500; never silently falls back or overspends.
   Reuse #132's backend budget governance and remove token/budget controls.
3. **M3 — Billing and UX, [#145](https://github.com/ErikFehlan/blumr/issues/145).**
   Stripe sandbox Checkout/Portal, webhook reconciliation, plan changes, payment
   failures, invoices, renewals and approved add-on purchases; pricing/settings
   and compact remaining-capacity indicators in the existing UI.
4. **M4 — Release evidence, [#146](https://github.com/ErikFehlan/blumr/issues/146).**
   Native PostgreSQL concurrency, API bypass/isolation, real document imports,
   1/20/100/500/1,000 candidate scenarios, billing lifecycle, migration/rollback,
   recruiter-reviewed quality and controlled rollout with explicit approval.

These milestones are tracked by the linked GitHub issues; no dated delivery
promise is implied. Each issue stays open until its full acceptance criteria pass.

## Accounting contract

- Prices are catalog data in development: Basic 2900, Advanced 7900, Pro 15000
  USD cents per user/month. No Stripe Price or public pricing change is created.
- One subscription account per user spans their workspaces, so creating a new
  workspace cannot multiply allowances. Membership is still required for each
  reservation. Future organizations can assign seats/accounts without changing
  evaluation identity or the reservation protocol.
- Periods carry explicit UTC start/end timestamps supplied by verified billing
  reconciliation or authorized manual grants. Renewals create a new period, never
  erase history. No calendar-month guessing or destructive counter reset.
- Basic: 1,000 rules, zero AI. Advanced: 1,000 rules and 100 shortlist AI. Pro's
  automatic evaluation route uses 500 deep evaluations. The initial catalog
  retains the brief's inherited 1,000 rules/100 shortlist capacity for Pro, but
  routing must not silently spend those as extra deep evaluations after 500.
  Clarify public allowance copy before checkout ships.
- A server-created evaluation key must include workspace/job/candidate identity,
  resume content hash, job requirements, approved feedback, and evaluation/model
  logic versions. The key excludes request ID, upload batch and billing period.
  Do not use a new random key on retry. Cached historical successes do not consume
  a new month's allowance; changed evidence/logic creates a different key.
- Reserve before work; reserved and uncertain work holds capacity. Only a
  persisted usable result consumes capacity. Definitive failure/cancellation
  releases it. Retries use a new attempt token; old attempts cannot settle new
  work. An uncertain provider outcome is never automatically released on timeout.
- Keep provider-call/token/cost telemetry separate. A failed evaluation can cost
  blumr money without costing the recruiter an evaluation. Reconcile with #117;
  provider estimates are not invoices.
- Screening integration now verifies Advanced shortlist membership and binds AI
  allowance reservations to durable worker leases. Rules results and usage commit
  together; AI results and settlement share the existing finish transaction.
  Unstarted worker expiry and verified admin recovery reconcile the same ledger.
  Account counts are indexed and serialized by subscriber; existing worker locks
  still protect the queue protocol. Hosted staging remains required before paid access.

## Safe migration and staging

No backfill enrolls existing users or assigns a Stripe customer. Existing
`workspace_plans`, access triggers, jobs, candidates, assessments, feedback,
benchmarks, lessons and auth remain intact. Explicit non-billable beta/trial/
complimentary accounts can be provisioned through the trusted backend; the admin
UI and audited grant operations are now implemented in this draft. With the feature disabled, current
behavior is unchanged. With it enabled, missing/inactive entitlements and missing
worker actors fail closed; there is no paid-plan default.

Develop on `feat/subscription-foundation`, based directly on audited main. Run
provider-free unit/route tests and local SQL first. A dedicated PR workflow uses
native PostgreSQL and contains no deployment or provider secrets. Do not invoke
main release workflows. Stage only after task attribution, complete tier routing,
atomic result settlement and migration parity checks exist; use the established
staging project, with disposable synthetic users and an isolated Stripe sandbox.

Before production: inventory beta/backer grants and active queues, preserve a
verified backup, rehearse additive migrations and rollback, explicitly map opt-in
users, then enable a small cohort. Rollback disables new enrollment/dispatch and
preserves the ledger, unsettled attempts and historical results. Disabling a gate
for paying users must not restore unrestricted AI; a controlled pause is required.

## Stripe recommendation and dependencies

Prefer hosted Checkout and Customer Portal, with server-owned price IDs and
customer mapping. Portal supports payment details, subscription management and
invoices. Verify raw-body webhook signatures; persist event IDs before async
processing, handle duplicates and reconcile current subscription state because
delivery ordering is not guaranteed. Use isolated sandboxes and test clocks for
renewal/failure/cancellation tests. Pin the stable API and SDK version at the
integration step. Account setup, tax treatment, fees, proration, upgrade capacity,
downgrade timing and add-on pricing need concrete sandbox configuration before
live approval; this branch does not claim those decisions are implemented.

Official references checked October 28, 2026:
- https://docs.stripe.com/webhooks
- https://docs.stripe.com/customer-management
- https://docs.stripe.com/billing/testing
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/changelog.md

## Screening integration and its limits

The branch now connects the foundation ledger to the existing direct rules route,
bulk result transactions, worker admission and durable result saves. Basic ends
after rules. Advanced selects up to 20 finalists per batch and uses its monthly
shortlist allowance. Pro selects up to 500 candidates and uses only deep capacity
for their AI evaluations. Exhaustion preserves saved uploads and returns a
specific allowance error; there is no automatic paid fallback.

`analysis_actor_id` captures the authenticated person who starts a batch. A replay
cannot transfer that ownership. The selected workers carry that same actor into
subscription and provider-cost admission. Legacy unenrolled users retain their
existing route; subscription accounts are still opt-in and are not provisioned
by either migration. Old/raw AI admission is denied for enrolled accounts. The
new admission RPC accepts only recognized operations and lease-bound assessments.

Completed logical evaluations survive renewals. Daily cache refresh does not
create another rules charge. Intake identity excludes document storage IDs and
filenames, while retaining resume evidence, job context and model policy. Cached
AI results can be persisted through a new lease without provider traffic. Failed
results release capacity; uncertain calls hold it. A database trigger follows
worker expiry and verified admin recovery so neither can strand a reservation.
Source changes reject stale results and roll back their usage together.

All subscription migrations remain absent from deployment scripts. Keep
`SUBSCRIPTION_FOUNDATION_ENABLED` off outside local fixtures. Applying SQL and
provisioning accounts can activate database guards independently of that Edge
Function flag; rollback must pause subscribed work and preserve its ledger,
not merely switch the flag off.

The Basic feedback path now saves original notes and recruiter-written
clarifications without interpretation or reassessment requests. Failed writes
retain the wording and support retry. Database queue guards also cancel newly
queued Basic intake/reassessment work while preserving already owned attempts.
Selected Advanced workers retain the batch initiator even when a Basic colleague
uploaded the resumes. Candidate-only feedback invalidates rules freshness without
charging the whole pool again; changed approved preferences still change the
billing identity.

Settings now shows the account's plan, active period, completed and pending
usage, and remaining evaluation capacity. The upload area carries the same
capacity summary. Basic shows rules; Advanced shows rules and shortlist AI; Pro
shows rules and deep AI. Subscribed users no longer see the legacy workspace
provider-call meter. Expired access and exhausted allowances retain saved work,
and usage refresh failures offer retry. Missing pre-rollout RPCs preserve legacy
behavior; authorization, network and internal failures do not silently grant AI.
Plan refreshes preserve clarification edits, and signout clears late responses.

Basic reporting and the remaining client budget controls are now complete in
this draft. Still open in M1/M2: migration parity and release sequencing. Stripe pricing, checkout/portal, billing lifecycle tests, hosted staging,
measured throughput and controlled rollout remain M3/M4. This is not
release-ready billing.

## Development without AI provider calls

Set `AI_PROVIDER_CALLS_DISABLED=true` for local Edge Function development. The
shared admission guard checks this before provider budgets; the transport checks
again before every retry and before using a custom fetcher. Workers stop before
reserving an AI evaluation. Rules processing and Basic job setup need no API key.
This flag is local configuration, not a production setting changed by this PR.

Run backend tests with network access explicitly denied:

```sh
deno test --no-prompt --deny-net --allow-env tests/*.test.ts
node --test tests/*.test.js
```

Provider responses in tests are synthetic local fixtures. No live model or Stripe
requests are needed. The subscription CI job has no provider/deployment secrets;
it runs PostgreSQL 17 SQL fixtures and independent connections contending for the
last allowances and identical result saves. Existing staging and deployment jobs
remain restricted to main and are skipped for this draft PR.

Local validation through feedback/usage UI: 520 Node tests and 82 Deno tests passed.
The SQL integration suite passed on PGlite, including Basic rules-only completion,
Advanced's 20/Pro's 500 selection boundaries, atomic exhaustion, renewals and cache
reuse, actor attribution, role permissions, definitive and ambiguous failures,
worker expiry, and verified recovery. Native CI is the concurrency authority;
local PGlite does not establish concurrent behavior or hosted throughput.

The feedback SQL suite reapplies its additive migration, saves raw notes and
manual clarifications through the existing evidence tables, checks Basic queue
suppression, preserves active lease recovery, tests mixed-plan initiator
attribution, and verifies subscriber dates/usage and function permissions. The
provider-blocked browser suite covers Basic note and clarification persistence,
failed-save retry, input retention during refresh, all three tiers, exhausted and
expired access, unavailable usage/recovery, mobile layouts (390/320px), and late
responses after signout. Existing recruiter, quick-start, review, bulk upload and
settings journeys also pass. CI includes the new browser and native SQL suites.

## Manual subscription administration

Admin tools now includes a Subscriptions area for an exact registered-email
lookup, review, and application of non-billable Basic/Advanced/Pro grants. Access
types are beta, trial, or complimentary, with an explicit future end time no more
than 366 days away. Verified account approval remains a separate prerequisite.
The form labels the browser time zone and sends an unambiguous UTC instant.
No accounts are created, approved, enrolled, or emailed by this migration.

Updating or extending an active grant preserves the period ID and its completed
and pending usage. Plan limits come from the server catalog; there are no custom
allowance inputs. Pausing blocks new evaluations and retains historical work.
Renewal is a separate explicit operation, permitted only after the current
allowance period expires. It creates a new period and preserves previous usage
and late settlement. Manual grants do not auto-renew monthly. Stripe-managed
accounts cannot be changed through these controls.

Every change records the authenticated administrator, target account, reason,
before/after state, time, and request identity. Audit rows have RLS and no direct
client writes. Public RPCs are invoker wrappers; their private implementations
check current app-admin authorization on lookup, mutation, and idempotent replay.
Stale versions are rejected; request and subscriber locks protect concurrent
first grants, while account/period locks coordinate with evaluation admission.
Retries after lost responses reuse the same request instead of granting again.
Revocation and signout clear the UI and fence late results.

Validation: 525 Node tests, the new browser journey, existing admin/subscription
journeys, and the SQL suite pass locally. SQL coverage includes repeat migration
application, authorization, exact lookup, invalid grants, response-loss replay,
stale edits, updates/downgrades, explicit renewal, historical settlement, billing
protection and audit permissions. Native PostgreSQL CI also exercises concurrent
initial grants, duplicate retries and grants alongside allowance reservations.
The local Supabase advisor could not connect because no Supabase database is
running on port 54322; native SQL privilege checks remain part of CI, and a hosted
advisor run remains part of staging. This migration is excluded from deployment
scripts, and no live grants, billing, emails or provider calls were performed.

## Rules reporting and legacy control cleanup

Rankings and CSV/text exports now read saved screening snapshots across all of a
job's upload batches, with workspace/job validation and paginated batch reads.
These are existing authenticated, membership-checked database reads; opening or
exporting a report never dispatches AI or reserves an evaluation. No schema or
production configuration change is included in this slice.

Basic reports show rules evidence out of 100, required-evidence checks and result
status. Dashboard counts and averages use current rules results, excluding missing
or stale results rather than treating them as zero. The newest saved upload wins
for duplicate candidates; an outdated newer result cannot expose an older score
as current. The database's existing daily/source/document freshness checks apply.
A refresh reads saved work; stale rules still require analysis from the upload
workflow. Advanced and Pro add separate reviewed JD/manager scores out of 10 and
assessment status; unapproved AI proposals never become reviewed fit scores.
Original candidate scores and approval records are untouched.

Failed reads clear the current report and offer retry; exports require a complete
successful refresh. Job/account changes fence late results. CSV values are quoted
and spreadsheet formulas neutralized. Phone layouts show labeled result cards.
Basic's guide and candidate labels refer to evidence review and manual feedback;
previously prepared assessments remain accessible without promising new AI work.

The old editable workspace provider-call allowance is replaced by a read-only
legacy access summary pointing administrators to Subscriptions. Recruiter settings
no longer expose provider token/cost/call meters, and unused client methods for
changing batch budgets and workspace allowances are removed. Existing backend
spending guards, historical workspace access and admin-only cost diagnostics remain.

Validation for this slice: 532 Node tests; provider-blocked browser coverage for
Basic/Advanced/Pro reports, CSV/text downloads, earlier uploads, stale results,
retry, job switches, signout and 390/320px layouts; existing subscription, admin,
settings, bulk upload and assessment-review journeys. Unit fixtures cover 1,000
candidate rows and 205 upload batches. These are correctness fixtures, not hosted
throughput measurements. Native database/concurrency and the full browser suite
continue to run in CI. Stripe sandbox integration is the next implementation step;
hosted staging, advisor checks, release parity and controlled rollout remain open.
