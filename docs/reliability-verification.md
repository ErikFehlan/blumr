# Reliability verification: items 8–12

This work extends the existing regression and fixture infrastructure. Production test identities use `example.invalid`; no confirmation or recovery email is sent. AI load testing is excluded.

| Item | Acceptance evidence | Automation |
| --- | --- | --- |
| 8: concurrent use | 5, 25, 50 independent authenticated workspaces; reads, closed-job/candidate saves, PDF upload/download, exact saved paths and bytes; zero failed requests; read p95 <=5s, write p95 <=10s; all fixtures removed | `production-load-canary.yml` |
| 9: failure injection | Ambiguous provider outcome stays claimed; 25 waiting retries cannot restart it; unacknowledged start cannot reach provider; lost commit acknowledgement replays the durable result; existing transient/permanent retry and queue-lease tests continue | `core-backend.yml`, `tests/reliability-faults.test.ts`, existing direct/queue SQL and browser tests |
| 10: scoped recovery | Archive generated synthetic job/candidate/document rows and actual PDF bytes to disk; confirm their deletion; restore parents/files/metadata; compare fields and SHA-256; owner access works and foreign access fails | `live-site.yml`, `reliability-recovery-drill.mjs` |
| 11: release safeguards | PR application/browser/backend/SQL checks, matching-commit public asset verification, live journeys and fixture cleanup; ancestor-only frontend rollback PR prepared and validated without executing old workflow code | Existing release workflows plus `prepare-rollback.yml` |
| 12: regressions | Failure assertions on every PR; recovery and cross-device checks plus complete recruiter journey on main releases; load canary on changes to its scripts or manual invocation; only synthetic aggregate results exported | Existing CI extended rather than duplicated |

Management-API-heavy production canaries, recovery drills, live release fixtures, and backend deployment share the same non-cancelling job lock. This prevents fixture setup/cleanup from exhausting management request capacity during a deployment and preserves cleanup when a newer run queues.

A successful test step is not enough if cleanup fails. The live run summary requires recruiter journey, duplicate verification, scoped recovery, and cleanup all to succeed. Load-test cleanup validates identity markers and sole workspace membership before deleting generated storage paths and accounts. Closed jobs prevent the canary and recovery fixture from initiating model assessments.

## Recovery limits

Storage deletion is verified through the privileged object listing before restoration. A recently downloaded file may still be served from a cache; a download response alone is not authoritative deletion evidence. Recreating the object without upsert must also succeed.

The scoped recovery drill is **not** a full-project backup restore. It does not prove recovery of Auth users, all customer workspaces, platform configuration, deployed functions, cron, or a historical Supabase physical/PITR backup. The management backup inventory is checked read-only and reported separately; unavailable inventory is not a passing restore result.

Supabase database backups contain Storage metadata but do not back up the resume object bytes. An ongoing off-site, encrypted resume-file backup and retention policy still need a configured destination and credentials. The synthetic archive is a test artifact retained seven days; it is not a customer backup system.

For a full disaster-recovery drill, restore a selected platform backup into a dedicated recovery project; pause outbound automation there, recover Storage objects from the independent file backup, check counts and checksums, then test isolated login, membership, signed downloads and recruiter workflows. Record backup age (RPO), recovery time (RTO), errors and cleanup. Do not restore a historical backup over production as a rehearsal.

## Rollback procedure

1. Choose a full main commit SHA with successful live release evidence.
2. Dispatch **Prepare reviewed frontend rollback** with that SHA. The target must be an ancestor of main. Only public HTML/assets are restored; current workflow code executes.
3. Review the generated PR and verify compatibility with the currently deployed functions and schema. Normal PR checks must pass.
4. Merge the tested rollback PR and wait for matching-commit public verification and live recruiter checks.
5. For backend regressions, prepare a reviewed forward fix or explicitly deploy compatible known-good functions. Do not reverse schema migrations or restore customer data automatically.

Branch-protection settings could not be read through the available GitHub integration (403). Required checks and Cloudflare's independent deployment gate therefore remain unverified; CI coverage alone does not prove an enforced gate. Staging-first release parity also remains outstanding. This work does not change paid infrastructure or configure a new backup destination.

## Evidence

CI artifacts record aggregate load metrics and synthetic live/recovery results. Private fixture state, passwords, access tokens and management/service keys are never uploaded. Release validation compares the custom domain's served public files with the expected Git SHA; a superseded commit cannot be reported as verified.
