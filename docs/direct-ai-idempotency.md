# Direct analysis duplicate prevention

Reliability checklist #4, October 1, 2026. Both authenticated analysis routes now claim a server-computed SHA-256 identity before budget reservation or provider work. The key includes the complete resolved evidence and feedback model, and is scoped to the verified workspace and actor. Identical simultaneous requests from that actor share a result across tabs/devices. Changed evidence or another actor gets a separate claim.

Duplicate callers poll for up to 80 seconds. Completed results are reusable for two minutes. Authentication, workspace membership and saved job context are checked again before every replay. The ledger and RPCs are service-role only, with RLS enabled and client grants revoked. The fingerprint stores no source text; the temporary response may contain assessment evidence.

Known HTTP failures release their claims so explicit retries remain possible. Provider exceptions and uncertain database completion retain ownership. An expired pending claim is never automatically stolen: after five minutes a second caller receives `analysis_outcome_uncertain`. Administrator recovery requires checking the claim ID against provider/usage logs before deleting that exact claim. Never bulk-clear processing rows to work around an outage.

Completed rows are removed when the same fingerprint is requested after expiration. Background retention cleanup is not yet installed; plan this before broader rollout. This pass does not promise cross-actor deduplication, prevent users intentionally creating separate jobs, or replace existing resume identities and guarded save conflicts.

Validation: 34 backend tests and all 186 Node tests passed. Twelve concurrent staging database requests returned one owner and eleven processing results. Staging also verified ownership checks, result replay, expiration and client permission denial. Synthetic staging users and claims were removed. Database schema is installed on staging; the edge handler has not been deployed. End-to-end two-tab/device verification, pending-claim recovery UX and production rollout remain pending. Reliability #4 is not marked complete.
