# Stage 5: validate workflows and measure return use

This increment adds an admin-only Recruiter retention report to Usage Analytics and strengthens the existing release checks. Recruiter screens retain their current layout. This release makes no new AI requests or reminder sends for analytics.

## Measurement contract

| Metric | Definition |
| --- | --- |
| External recruiters | Accounts an application admin explicitly classified as external. Admin accounts and reserved `@example.invalid` fixtures are excluded automatically. Other accounts start unreviewed; unknown accounts are never silently called external. |
| First tracked assessment | First durable resume-intake completion observed for an account after this migration. This includes existing accounts and is not a lifetime first-use claim. Manual ratings, direct legacy analyses, failed tasks and feedback reassessments do not qualify. |
| Second candidate assessed | Completion for a second distinct candidate, across that account's workspaces. Revisions, retries, approval and repeated analysis of one candidate do not create a second candidate. |
| Time to second | Median elapsed hours between first and second tracked candidate completions, with the number of completers shown. It is not a median for all activated users or a later-day return rate; a same-session batch can qualify. |
| Saved-work return | A server-confirmed human save or review on a later calendar day in America/New_York, within 7/30 elapsed days of the first tracked assessment. Logins, navigation, background processing and comparison views do not count as saved work. |
| Comparison on return | A browser-observed view of 2–4 distinct candidates from the same authorized job on a later day, within the same window. Server-side scope validation does not prove human attention. |
| Submittal on return | A committed nonempty changed submittal draft on a later day within the window. Copying an unchanged draft, failed saves, automatic updates and opening an editor do not count. This does not establish that a submittal was sent. |
| Window denominator | Only activated accounts with a full 7/30 days of follow-up. Empty denominators show “Not mature yet,” not a measured zero-percent return rate. |

Tracking is prospective. Existing business records and drafts are preserved, and old events are not reconstructed into a new cohort. Cohort classification applies to the full tracked history; it is not a feature rollout or causal experiment. No claim that a reminder or a specific retention feature caused a return can be made from these metrics.

## Storage and permissions

`retention_events` retains workspace/user/job/candidate/document identifiers, event type, stable source identity and server time. It stores no resume, feedback, generated assessment, submittal text or free-form browser metadata. Upload/completion links are captured transactionally from the confirmed usage ledger while their source tasks exist. Submittal saves are captured in the business-record transaction. Comparison retries and rerenders deduplicate by user, job, session and sorted candidate IDs.

The three new tables have RLS and no anonymous or authenticated table access. Recording triggers are not client-callable. The comparison RPC derives the caller from `auth.uid()`, derives the workspace from the job, and checks membership plus each candidate. Reporting and cohort edits require application-admin authorization. User-editable metadata never grants access or external-cohort membership.

Candidate/job deletion preserves historical identifier-only usage. Account/workspace deletion removes its events; reports describe retained accounts, not a permanent acquisition cohort. Reapplying the migration does not reset the tracking boundary or import history. Failed analytics refreshes retain the prior report with an explicit stale warning. Authorization loss removes the report.

## Workflow coverage

| Risk | Required evidence |
| --- | --- |
| Existing search → another candidate | `retention-browser.cjs`, `recruiter-browser.cjs`: job-bound repeat uploads, preserved requirements, reload and batch recovery. |
| Original-file access | `retention-browser.cjs`, `data-service.test.js`: PDF/DOCX originals, identical downloaded bytes, storage/renderer failure fallback, scoped paths, mobile, close/sign-out cleanup. Live browser release checks download all three synthetic originals and deny the second account. |
| Upload failures | `recruiter-browser.cjs`, resume-intake tests: individual failure recovery, retries without duplicate candidates, background completion and restart. |
| Decisions and continuity | `decision-workspace-browser.cjs`, `feedback-impact-browser.cjs`: evidence comparisons, saved-draft reload, failed/in-flight saves, approved feedback, scoped dismissal and existing records. |
| Account boundaries | Existing PostgreSQL and live security suites; new SQL rejects foreign jobs/candidates, forged completions and nonadmin reporting/cohort changes. |
| Retention integrity | `retention-measurement.sql`: real recording triggers, failed/polled/repeated tasks, source mapping, rollback, same-content saves, distinct candidates, calendar boundaries, mature windows, old records, repeat deployment and deletion. |
| Admin report | Application and browser tests: accurate empty denominators, external-only figures, escaped labels, cohort save failures, refresh failures, role revocation and mobile layout. |
| Actual release evidence | `retention-live-check.mjs` checks identifier-only events for the current synthetic live workflow before cleanup. Fixture/run/workspace guards prevent widening that query. |

The normal PR pipeline runs unit/browser tests, isolated staging and PostgreSQL checks. The existing core smoke test also verifies live worker-to-retention linkage and unchanged saved-draft counts against its owned synthetic candidate, with nonadmin access denial. Production publication retains the existing backend and Cloudflare gates. The new live checks run only after the matching production release and verify its served files before creating temporary accounts. Synthetic accounts/documents are removed even after failures.

## Reading results after rollout

Review the unclassified accounts in Usage Analytics before using external-recruiter figures. Check first-to-second completion counts as activity arrives; assess 7-day and then 30-day results only as those cohorts mature. Compare numerator and denominator, not just percentages. The tracking addition itself does not demonstrate improved retention, and this PR does not contain mature post-release observations.
