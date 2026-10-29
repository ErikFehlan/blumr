# Billing release security review — 29 October 2026

## Existing privileged RPCs

Reviewed all 73 production public `SECURITY DEFINER` functions executable by
`authenticated`. The companion `subscription-security-review.json` records each
signature, authorization boundary and SHA-256 of the actual deployed definition.
All 73 deny anonymous execution and use an empty fixed search path. Definer
privilege is intentional for the checked administrator, workspace, screening or
own-account operation; the advisor notice is retained rather than suppressed.

Checked the delegated `require_screening_batch`, `has_beta_access` and
`standard_account_export` implementations as well. Membership follows canonical
Auth UUIDs, verified/approved access, bans and pending deletion. The export's
dynamic table list is fixed, identifiers are quoted and workspace IDs are bound
as parameters. Screening upload delegates to the existing guarded batch creation.

A read-only transaction on production impersonated an unregistered authenticated
UUID with a forged administrator email claim. All **22 administrator RPCs**
rejected it with `42501`; administrator status, foreign membership and malformed
resume-path access also returned false. No private records were returned and no
test records were committed. Existing native CI additionally covers revocation,
cross-workspace isolation, direct REST and Storage forgery, and screening access.
This review does not claim every possible argument/interleaving was exhaustively
tested, or that the entire application has no security defects.

## Billing reviewer identity correction

The operator-only risk RPC used an email lookup while the application's admin
check uses `app_admins.user_id`. The new additive
`subscription_billing_reviewer_identity` migration binds reviews to that permanent
UUID, a nondeleted Auth user and `has_beta_access`. An administrator's email change
preserves identity; another account reusing the old email gains no authority.
Revoked administrators cannot submit or replay decisions. Browser access remains
denied. The native database regression tests cover all three cases.

## Password protection

The organization currently reports `plan=free`, `tier=tier_free`. Supabase's
leaked-password protection is a Pro-plan feature and is not enabled. Upgrading the
organization creates a recurring charge; no upgrade has been purchased. This
finding remains an explicit live-launch decision, not silently accepted or
reported as fixed. Reference:
https://supabase.com/docs/guides/auth/password-security

## Closed release baseline

Production has 13 approved beta accounts, 15 active beta workspace plans and no
subscription accounts. Before installation no subscription tables existed. The subscription screening SQL
checks `subscription_scope_managed`; unenrolled beta users keep their existing
workflow and are not converted into paid accounts by migration.

Production AI was paused for the authorized release work: `security_limits.ai_paused`
is true and both `ancalagon-criteria-worker` and `ancalagon-job-reassessment` are
inactive. Provider usage baseline is 173. Staging remains paused at 8 calls.
Paid model preflights and scheduler activation now require the separate
`PAID_AI_RELEASE_ENABLED=true` gate. The closed main release instead verifies
the exact deployed backend and disabled configuration before Cloudflare publishes,
then compares served assets and runs a public browser probe without AI or fixtures.

Closed backend deployment **40951227952** installed all eight reviewed migrations
and nine functions. Source readback matched all 51 dependency files; bundle hashes
and file fingerprints are in `subscription-production-deployment.json`. Checkout
returns disabled, the cohort is empty and subscription enforcement remains off.
The post-installation advisor scan at 20:46 UTC retains the same 73 previously
reviewed definer warnings and the Free-plan password warning. Its 34 RLS-without-
policy notices include intentionally service-only tables. All 13 new ledger tables
have RLS and deny anonymous SELECT and authenticated INSERT/UPDATE/DELETE.

The daily full backup failed October 12–29 because the replacement scoped token
did not include pooler-configuration discovery. The production Dashboard supplied
the verified password-free session route; no token permissions or database
passwords were changed. Full backup run **40945589186** passed on October 29:
encrypted recovery, isolated PostgreSQL restore with outbound networks disconnected,
exact row and privilege checks, and all 160 Storage objects (19,632,156 bytes).
Encrypted artifact **12928364091** is retained until January 27, 2027; its uploaded
ZIP SHA-256 is `bdf96959604b694953bd69489e6ccd310edfb3c37ba1fb0c0276820081077efb`.
https://github.com/ErikFehlan/blumr/actions/runs/40945589186

## Retired AI endpoints

Two deployed routes outside the active application source (`analyze-candidate`
and `analyze-patterns`) still contained direct provider calls without the modern
budget/pause guard. The active frontend does not call either route. Both now
serve a fixed disabled response, retain gateway JWT verification and contain no
provider transport. Network- and environment-denied tests passed and deployed
source readback confirmed the disabled implementation. Original bundle hashes:

- `analyze-candidate`: `390307ef0a9d30404bcfecc36f3bfa5e420ffe222e029be8405ab4d279cd29bc`.
- `analyze-patterns`: `5463fa52a9dc348e6c47401d4dd17d154daba7df45d227c22f5e222ded7bbb44`.

Disabled bundle hashes are respectively
`032a187f57647ac8ae23961cbaab41edc999b6ef54112326902821c67a730045` and
`ce06a5d089af6b79a66fa4ecc85acd7b14aa12ee52dfb33baf95a9410e0a94b3`.
The 173-row application provider ledger does not cover any historical calls that
may have bypassed that ledger through retired endpoints; no such call was made
as part of this review.

## Installed release recovery checkpoint

After installation, main backup run **40953103986** passed at 20:58 UTC, including
exact restored row checksums, RLS, grants, policies, privileged function hashes
and all 160 stored objects. Artifact **12930754838** expires January 27, 2027;
uploaded ZIP SHA-256:
`1bb283c477903b27ede914aeaa2e459b7859f456f093b6ea62f0260d2e56113d`.
https://github.com/ErikFehlan/blumr/actions/runs/40953103986

Closed configuration run **40952223609** also passed: the reconciliation bearer
is installed in Vault and runtime with matching digests, its five-per-minute
scheduler is configured inactive, and all eight migrations, nine deployed bundles
and 13 ledger permission boundaries pass the read-only verification. Production
provider usage remains 173, with checkout and all three workers disabled.

The first main frontend publication was correctly blocked by an allowance test
harness failure. Child-process `exit` sometimes fired before SQL stdout drained:
a 320-process reproduction lost 16 outputs at exit, while waiting for `close`
retained all 320. The concurrency helpers now await `close`; the native allowance
race passes ten consecutive rounds with persisted reservations checked separately
from process responses. No application SQL or deployed function changed for this
test correction, and the publication gates remain required.


## Closed continuation: preserve beta and gate AI sales

The October 29 continuation refreshed production evidence: all eight migration
checksums, nine bundle fingerprints, 13 ledger isolation boundaries and closed
runtime digests passed again in run 40954869096 (attempt 2). Public verification
again matched 70 served files. Database reads found 13 approved beta records,
12 verified eligible Auth identities, 15 active beta workspace plans and zero
subscription accounts. Provider usage remained 173; all three workers stayed
inactive. Advisor counts remain 73 reviewed definer notices, 34 no-policy
notices and the Free-plan leaked-password warning.

Two code corrections were prepared in PR #150:
- Live Advanced/Pro checkout requires explicit AI-sales approval and enabled
  runtime provider calls before a customer lease or Stripe object is created.
  Basic, portal access, receipts and reconciliation retain their existing gates.
- The TypeScript entitlement adapter now matches the SQL opt-in scope for
  unenrolled members. A canonical missing-subscription result alone is insufficient:
  a service-only scope check must return exactly false. Managed, held, inactive,
  expired and ambiguous/error states remain blocked. Both privileged reads reject
  redirects. Existing beta access checks and the AI pause still apply.

All 12 verified beta workspace memberships currently produce the canonical
missing-subscription/unmanaged combination. The regression proves that combination
retains the legacy path without making grants, and that unavailable or malformed
scope results fail closed. Paid-account negative cases do not enter the fallback.

No migrations, beta records, Auth accounts, workspace plans or live Stripe
objects are modified by these corrections. Exact patch source and deployed bundle
fingerprints are recorded in `subscription-production-deployment.json`.
Policy drafts and the activation package are review documents, not approved legal
terms or an activation decision. Live Stripe configuration awaits connection.
