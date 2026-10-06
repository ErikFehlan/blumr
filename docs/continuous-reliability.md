# Continuous reliability work

## Independent checks

`blumr-operations` runs on Cloudflare every five minutes. It checks the production startup document and a token-protected Supabase endpoint returning aggregate queue, worker, access-control and backup evidence. The public `/status` endpoint exposes only coarse health and heartbeat freshness. Database credentials and candidate content never leave Supabase. A Durable Object retains the last observation and arms a ten-minute missed-check alarm before beginning network calls.

The monitor checks the same Cloudflare platform that hosts the site. Its alarm is an independent scheduler, not an independent provider. Keep GitHub monitoring as a second observer; a total Cloudflare outage still needs a separate external notification path. Do not describe this as complete operational alert coverage until that path and delivery are verified.

The notification transport uses a stable event ID as the Resend idempotency key, retries temporary failures with bounded backoff, and refuses automatic retries beyond 23 hours. An accepted API response is not delivery confirmation. `ALERT_FROM`, `ALERT_TO` and a sending-only `RESEND_API_KEY` must be configured privately after sender and recipient confirmation. No recipient is guessed. Notification configuration and a controlled delivery/recovery test remain acceptance gates.

The existing GitHub operations workflow refreshes durable backup evidence only after checking that a successful backup run has a nonempty, unexpired encrypted artifact. Backups older than 36 hours raise an incident. The seeded backup evidence references run 37382744759, artifact 11375777367, verified on October 6.

## Sustained workloads and spending

Run `Extended staging reliability` with profile `hour` or `four-hours`. Each uses six waves of three resumes across three isolated accounts, followed by three feedback reassessments. Waves span at least the selected wall-clock duration. This establishes sustained low-rate behavior, not a high-throughput capacity claim. The staging project still has one previously held ambiguous intake attempt, so record degraded-capacity evidence separately.

Before creating any jobs, the fixture registers a shared ten-dollar reservation ceiling and forty-call maximum. Every normal reservation upsert for those workspaces passes through a private staging-only trigger before the transaction commits. Its atomic update counts one input byte as one token, assumes no cache discount, and reserves the full output allowance. Failed or uncertain calls do not refund the guard. This is a conservative ceiling under the documented model/rate assumptions, not an invoice. Unknown model pricing remains a stop condition in the test report. Six-hour guard expiry fails closed. Production workspaces are never registered.

Fixture sessions renew on expiry. Private manifests retain ownership and object paths before writes. Cleanup removes only verified test-owned accounts, workspaces and objects; it never releases an uncertain provider reservation. Workflow cancellation runs cleanup, and the next staging run must not start until the shared concurrency lock clears. An abruptly lost runner still requires manifest recovery or verified orphan-fixture cleanup; this is not yet an external fixture reaper.

## Extended interruptions

The 1-, 5- and 15-minute tests use real elapsed time and the production lease implementation, with simulated RPC/provider transports. They establish bounded save retries, visible pending persistence, blocked provider replay after lease loss, and identical-result persistence after connectivity returns in a surviving process. They do not prove that an actual terminated worker retains memory or that a hosted database shutdown recovers. Existing Postgres recovery tests cover lease reclamation and durable fencing separately. A hosted disruption rehearsal remains a later gate.

## Hosted recovery rehearsal

A separate hosted target is required. Both current projects are protected. The intended temporary name is `blumr-recovery-YYYYMMDD`, in the user-confirmed organization, with cost quoted and accepted before creation. Supabase currently reports the existing organization as **Ancalagon** on the free plan. No new project or paid resource has been provisioned.

1. Obtain the approved temporary target and record provisioning start time. Keep production DNS unchanged. Do not install provider keys, production SMTP credentials, worker secrets or production cron configuration.
2. Recover the encrypted artifact using `scripts/recover-backup.mjs` and the separately stored recovery key. Never put the key, decrypted rows, resume bytes or credentials in CI artifacts.
3. Set `RECOVERY_TARGET_REF`, matching `RECOVERY_CONFIRM_TARGET`, `RECOVERY_ORGANIZATION_ID`, `RECOVERY_DIRECTORY` and private `SUPABASE_ACCESS_TOKEN`. Run `node scripts/hosted-recovery-preflight.mjs`. It is read-only and refuses production, staging, old or nonempty projects, existing workers, schedulers and Vault secrets. It verifies archive format and every Storage checksum. A pass is not a restore.
4. Restore the archive first into the existing disconnected local recovery environment. Before producing a hosted import, remove queued outbound HTTP requests, deactivate all cron jobs, remove source Vault secrets and rebind only target-specific settings. Inventory every intentional difference. Do not import the raw production data dump into an online host: it contains active configuration. Hosted custom-role grants must be checked against target managed-role restrictions; do not ignore grant errors.
5. Import the reviewed application/Auth data, schema, RLS, grants, policies, managed triggers and separate Storage bytes into the quarantined target. Compare exact data checksums and security fingerprints, allowing only the explicitly reviewed quarantine differences. Recheck that no production URLs, runnable schedules or outbound credentials remain.
6. Deploy matching Edge Function versions with target credentials. Verify Auth, owner/foreign access to restored data and files, and a synthetic queued assessment on the target with a bounded test budget. Verify notification routing without contacting restored users. Enable only target workers after these checks.
7. Record time to usable service, snapshot age, exact checksums and test evidence. Keep DNS unchanged. Retain encrypted evidence and destroy the temporary project only after explicit approval of that destructive action.

Steps 4–6 still require a reviewed hosted import implementation and execution. The current automated backup restoration proves an isolated local database restore; it does not yet prove a hosted replacement application.

References: [Supabase database backups](https://supabase.com/docs/guides/platform/backups), [CLI backup and restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).
