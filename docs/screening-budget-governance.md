# Server-owned batch AI spending

Related: Copilot epic #123, implementation #124, [audit and six-week roadmap](recruiter-copilot-roadmap.md).

## Behavior

New screening batches receive the existing **$5 server default**. The historical `p_budget` argument remains accepted for compatibility, but it is ignored for initial creation and replay. It cannot raise or lower the server cap. Batch replay still checks job, workspace and manifest identity, and preserves any subsequent administrator adjustment. Existing batch budgets and reservations are not rewritten by the migration.

`update_screening_budget` requires both an authenticated application administrator (`is_app_admin`, backed by the existing server-managed account allowlist) and access to the batch's workspace. A workspace owner/admin alone is not an application administrator. Anonymous callers have no execute grant, and ordinary users cannot write the batch table directly. Administrators retain the existing monotonic increase and $100 ceiling. No cap edit starts or retries an assessment; finalist selection remains a separate explicit action.

The recruiter screen no longer contains new-batch/current-batch budget inputs, a raise-budget button, or internal provider reservation/cost accounting. The backend retains that accounting and its existing limits. When analysis reaches a limit, the screen says the shortlist and completed assessments are saved and directs the recruiter to their blumr administrator. No new scores, evaluation logic, model calls or automatic communications are introduced.

This is a focused governance change, not a complete usage-plan redesign. It does not add a new admin settings page or a provider invoice reconciliation system. The scoped admin RPC and trusted backend operations remain the administration route. Per-candidate, batch, workspace and global admission protections continue to apply.

## Release and compatibility

The additive migration replaces only `create_screening_batch` and `update_screening_budget`; it creates no tables and updates no existing batch rows. The core and screening deployment scripts apply the override after the original workflow in one transaction, so legacy permissions are not briefly restored during a repeat deployment. The structural-parity validator checks the exact replacement source, signature, execution mode and grants.

The normal release sequence remains backend migration before frontend publication, followed by existing staging/live gates. Frontend asset versions are bumped so cached pages receive the updated adapter and screen. An older tab may still display budget controls, but the upgraded backend ignores creation budgets and rejects ordinary-member cap changes. A refreshed tab removes those controls.

For a frontend rollback, retain the backend governance migration: prior clients still import with a server default, and attempts to raise caps are rejected. Rolling back the backend to the original member-editable functions would restore the weakness and should not be the default recovery action. No data deletion or cap rewrite is required for rollback.

## Verification

- Baseline: 501 Node tests passed on audited main. Updated suite: **503 passed**.
- `tests/screening-budget-governance.sql` passes locally on PGlite. It runs the existing bulk/durable-worker SQL suite, then tests repeated upgrade, unchanged saved budgets, forged/omitted/null client budgets, direct-write denial, ordinary-member/anonymous/missing-identity denial, scoped admin updates, foreign-workspace denial, invalid/decreased/excessive caps, replay after cap changes, no queued/paid work from budget edits, and reservation/rate/cache guards after upgrade.
- The browser journey passes with the actual application, PDF/DOCX extraction and ZIP intake, using simulated database/provider transports: 25 files, 23 unique saved candidates, explicit damaged-file handling, lost-upload recovery, no initial provider calls, 20 simulated finalist assessments, replay/reload without duplicates, explicit assessment approval, source viewing, scope preservation during job switching, and a 390px layout. It also verifies no budget inputs and the limit-reached message. Local browser: Chromium 153, Playwright 1.58.2; repository CI uses its pinned Playwright browser image.
- Data-adapter tests verify that even an extra caller-supplied budget is not sent. Structural-parity tests reject old function bodies and unsupported overrides.
- JavaScript syntax and `git diff --check` pass.

The SQL suite is wired into both the rules-screening and core CI gates for native PostgreSQL validation. Hosted staging/provider tests and production deployment have not been run as part of local development. No paid AI requests were made. Local synthetic checks do not establish real-world accuracy, provider latency, production isolation or commercial savings.

## New local benchmark observation

The unchanged screening benchmark was rerun on Node v24.22.1, 12 repetitions per size, with 20/100/500/1,000/2,000 synthetic text candidates and zero provider calls. At 1,000 candidates, parse/score/rank measured 253.99 ms median and 368.80 ms sample p95; scoring already-parsed evidence measured 68.34 / 100.77 ms. At 500 candidates those measurements were 114.50 / 167.29 ms and 37.19 / 50.26 ms respectively.

This is CPU/hash work only: no document extraction, upload, database, concurrent users or AI. Twelve samples do not establish a production tail-latency SLO. Hardware/runtime differ from prior reports, so these observations are not evidence of a performance improvement or regression caused by budget governance. Full parity, user-time and cost baselines remain tracked in #125.
