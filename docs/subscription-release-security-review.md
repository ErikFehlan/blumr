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
subscription accounts/tables before installation. The subscription screening SQL
checks `subscription_scope_managed`; unenrolled beta users keep their existing
workflow and are not converted into paid accounts by migration.

Production AI was paused for the authorized release work: `security_limits.ai_paused`
is true and both `ancalagon-criteria-worker` and `ancalagon-job-reassessment` are
inactive. Provider usage baseline is 173. Staging remains paused at 8 calls.
Do not use the ordinary main deployment path for this release without removing
its paid model preflight and scheduler activation: those conflict with this
release's explicit no-paid-AI requirement.

The daily full backup failed October 12–29 in the remote roles dump. A new backup
must complete encrypted archive recovery, isolated database restore, exact row
and privilege checks, and every Storage byte before production DDL. Billing-only
recovery evidence does not satisfy this full application backup gate.
