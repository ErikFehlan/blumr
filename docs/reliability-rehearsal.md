# Reliability rehearsal before wider beta

Status: **partial**. Local tests and the synthetic release journey do not establish 25–50-user throughput or disaster recovery. Record the date, build SHA, environment, measurements, cleanup result, and any incident for each exercise. Never place real resume contents, credentials, database dumps, or Storage objects in this public repository or CI artifacts.

## Current blocker and release gate

The September 25 release preflight received OpenAI `insufficient_quota / project_spend_limit_exceeded`. This is an enforced project spending cap, not a transient request-rate limit. Do not retry the preflight or increase the cap automatically. The project owner must review the API project's spend, hard limit, and desired monthly ceiling. Once capacity is restored, rerun the release gate and confirm the real live journey, including a saved resume surviving tab closure, passes. Until then, the live tab-close test is **unverified**.

## Backup and isolated restore

The production Supabase project is on the Free plan. Supabase recommends CLI database exports and off-site backups for Free projects; its managed daily backup/restore workflow is on paid plans. Database backups contain Storage metadata, not resume file bytes. A row count or successful write is not a recovery test.

1. Choose a restricted, encrypted off-site destination, an operator with access, a schedule and retention period. Keep the export out of GitHub, public CI, and short-lived workspaces. Set a key recovery procedure and test access to the destination.
2. Use the [Supabase CLI database dump](https://supabase.com/docs/reference/cli/supabase-db-dump) with the project's private connection string to export roles, schema and data. Confirm the dump covers the needed application and Auth records; keep CLI and Postgres versions with the manifest. Export every private resume Storage object through an authenticated Storage API/S3 client into the same protected backup set, with path, byte size, checksum and timestamp in a manifest. Include application migrations, Edge Function versions and the settings/secrets inventory without putting secret values in the manifest.
3. Validate nonempty files, dump completion, encryption, off-site retrieval and a checksum of each object. A metadata-only export does not satisfy this step. Do not log candidate data.
4. Restore to an isolated local or disposable project, never over production. Block outbound email, webhooks, scheduled jobs and `pg_net` before restoring any copied configuration, so test data and credentials cannot trigger production side effects. Rotate project-specific secrets and configure Auth, Storage and Edge Functions separately as required.
5. Compare source and destination counts for `auth.users`, `workspaces`, `jobs`, `candidates`, `candidate_documents`, `candidate_assessments`, `manager_feedback`, `interview_outcomes`, `resume_intake_tasks`, and every private Storage object. Compare sample checksums and open a restored resume and screening brief using a test identity. Exercise separate-account access and reject cross-workspace reads.
6. Record the backup's last captured write, restoration start/end, missing items, measured recovery point (RPO), recovery time (RTO), and a failed-restore remediation. Preserve the source and encrypted backup until the rehearsal is signed off.

Source: [Supabase Database Backups](https://supabase.com/docs/guides/platform/backups). A private destination and isolated restore target must be chosen before exporting real applicant data; **no restore has been verified yet**.

## Controlled 25–50-user test

Use a separate staging project with production-equivalent limits and synthetic accounts, jobs, resumes and feedback. The Free production project has no verified restore path. Start with 5 distinct signed-in users, then 25, then 50; keep each stage long enough for background processing and cleanup to finish. Give each user a separate workspace. In each stage, mix navigation, job save, one resume upload and assessment per user, brief review, feedback save, refresh/tab close, and sign-out/relogin. Bound the total AI calls and set a maximum spend before starting.

Record request volume, p50/p95/p99 latency, failures by endpoint, assessment queue delay, retry count, DB connection pressure, CPU, Storage errors, and model usage/cost. Check that every saved candidate, note and feedback item persists once and no user sees another user's data. Stop on any data leak, missing saved record, uncontrolled spend or sustained error rise; collect logs without applicant contents. Verify synthetic accounts, files and workspaces are removed after each stage. Label the result **staging throughput**, not production capacity; run a smaller canary on production before increasing access.

## Interruption matrix

| Event | Expected observation |
| --- | --- |
| Reload after durable resume save | Same candidate and pending/ready task return; brief can be reviewed once. Covered by CI browser test. |
| Close and reopen tab during assessment | Same candidate and brief return from server; live journey added, pending the spending cap. |
| Disconnect before file save | Show retry; do not claim unsaved local file survived. |
| Disconnect after save; reconnect | One saved document and one task; automatic status recovery or useful retry. |
| Session expires during review | Reauthenticate without exposing another workspace; saved draft remains. |
| Two tabs approve the same assessment | One canonical decision; stale review cannot overwrite it. |

Run each with disposable accounts, verify persisted state via the normal authenticated API, and report failures separately from cleanup failures.
