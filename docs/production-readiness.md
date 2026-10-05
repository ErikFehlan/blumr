# Production readiness evidence

This work hardens existing recruiter workflows. Passing these gates is evidence
for their stated scope, not a claim of unlimited scale or complete security.

| Area | Automated evidence and pass criteria |
|---|---|
| Real paid load | Staging bursts of 3 then 9 uploaded PDFs across three independent workspaces, followed by three simultaneous feedback reassessments. Upload p95 ≤10 seconds; completion p95 ≤10 minutes; every expected attempt accepted and closed. Existing limits remain 6 global, 3/workspace and 2 intake. Ten duplicate requests must not create extra worker attempts. |
| Failure recovery | Provider-fence, interrupted-body, lost-acknowledgement, heartbeat and PostgreSQL concurrency tests. A simulated 40-second database outage must save the identical completion without another provider call; sustained outage must leave ownership held within the retry budget. |
| Security | Populated tenant isolation, all discovered admin RPCs rejecting non-admins, author immutability, private upload metadata validation, exact deployed function and permission parity, plus five malicious resumes and an injected job description assessed by the real model. |
| Operations | Production health every 30 minutes; daily staging workflow; daily independent encrypted backup with isolated fresh-database restore, row checksums, document-byte hashes and permission/policy/function fingerprints. Recovery duration and snapshot age are retained. |

The staging run records the existing held/uncertain attempt baseline. A previous
synthetic interrupted intake remains held until its provider outcome is verified.
Measurements with that hold prove degraded-capacity behavior, not a healthy
two-slot intake benchmark. Fixture cleanup removes only verified synthetic
identities, workspaces and recorded objects; it never releases uncertain calls.

Usage evidence records provider call and token counts. Missing billing rates are
reported explicitly. For short-context gpt-5.6-sol, the separate conservative
token estimate uses $5/million input (cache-write ceiling) and $20/million output,
checked 2026-10-05 against https://developers.openai.com/api/docs/models/gpt-5.6-sol.
The test ceiling is $10 and 40 recorded calls; those assertions run after the
bounded workload and are not real-time billing caps or invoice reconciliation.

Operations reports aggregate failures for overdue queues, expired or uncertain
workers, inactive schedulers, permission drift, startup failure and a missing or
older-than-36-hours verified backup. Failed GitHub Actions runs use repository
notification settings. No separate pager or email recipient is configured here.

The independent backup run on 2026-10-05 (GitHub run 37364891152, attempt 3) restored
the application database and 105 stored objects successfully, including the new
access-control fingerprints and managed-schema policies and triggers. Recovery
runs in a fresh local Supabase database disconnected from external networks;
files are recovered to disk. A complete hosted Supabase/Auth/Storage/worker and
DNS cutover remains a separate disaster-recovery exercise.

Upload controls check signatures and bounded document structure in the browser,
and MIME allowlists, private object ownership, actual stored size/type and source
length at server admission. They do not constitute server-side content scanning
or malware detection. Source instructions are isolated from trusted prompts;
schema validation, evidence checks and human approval remain mandatory.
Recognizable evaluator instructions are excluded from deterministic priorities
and eligible source quotations while preserving exact, contiguous legitimate
text. This is a narrow defense in depth, not a complete injection detector.
The first live adversarial run caught an instruction being ranked by the
deterministic extractor; its regression fixture now covers both browser and
server paths. The staging assertion checks generated items and retains the
original description unchanged for revision tracking.

Remaining proof includes sustained larger-volume load, independently reviewed
security coverage, long hosted provider/database outages, server-side scanning,
and full hosted recovery. Never release an uncertain provider reservation merely
to make a test pass.
