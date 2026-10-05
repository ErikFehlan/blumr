# Durable assessment worker recovery

Scope: resume intake and job reassessment. New product features are paused while
hardening and reliability work continues. Existing human approval and evidence
validation still control publication of candidate scores.

## Ownership and failure behavior

Each claim creates a service-only attempt keyed by an immutable lease UUID. Its
reservation survives edits and deletion of the task row. It contains identifiers
and execution metadata, not resumes or model output. Terminal metadata is removed
after seven days; uncertain work is never automatically purged.

| Event | Behavior |
|---|---|
| Worker disappears before provider start | Scheduler closes the expired attempt and retries with a new lease, within the existing three-attempt limit. |
| Worker stays healthy | Heartbeat every 30 seconds renews a two-minute lease up to a five-minute deadline. |
| Duplicate worker or expired/superseded lease tries to start a call | Database denies provider start; no provider request is sent. |
| Connection, response body, timeout or server outcome is uncertain | Attempt retains its reservation and becomes an admin recovery item. No transport replay. |
| Provider explicitly rejects work, e.g. HTTP 429 | Complete response is acknowledged; existing bounded queue retry applies. |
| One invalid intake output | One evidence-validation repair may run, with its own fenced request ID; original evidence and validators remain unchanged. |
| Result-save acknowledgement is lost | Repeat the same save with bounded exponential backoff (up to nine attempts, 60-second retry budget plus an in-flight RPC). A committed completion is idempotent; no second provider call. |
| Database stays unavailable after a response | Preserve the unresolved attempt for recovery. Do not convert a possibly saved success into a retry. |
| Sources change during processing | Hold the old reservation until settled; reject its stale result; process the latest saved revision. |
| A terminal result arrives late | May finish only the still-owned attempt against current evidence; an admin-released or replaced owner cannot publish. |

The scheduler invokes recovery on each claim pass. Shared global/workspace and
route capacity limits count started unresolved attempts even after lease expiry.
A held attempt also prevents a second pipeline for the same candidate. Queued
work blocked by an uncertain attempt shows a recovery message. There is no
provider-side exactly-once promise: an interruption can leave a paid result
unavailable. Safe recovery can therefore involve another charge.

## Admin recovery

Use Admin tools → Interrupted analyses. Background entries include a request ID
of `durable-<lease UUID>-<call UUID>` for provider log correlation. Check that the
earlier provider request has stopped, enter a 20–500 character verification note,
and confirm verification. The server enforces admin access and requires a
seven-minute shutdown window after the claim (longer than the documented
400-second hosted worker lifetime). Only then can recovery release the reservation
and queue the latest saved work. The audit records the actor, attempt, request ID
and verification note; it does not contain candidate evidence.

Changing inputs or clicking an ordinary retry never releases an uncertain
reservation. Finishing the original call or verified admin recovery does.

## Deployment and checks

The migration first tracks any existing processing attempts conservatively as
legacy provider work. Old claim RPCs then return no work, so an old worker cannot
start an unfenced batch during deployment. Successful legacy completions can
settle their existing attempt; uncertain legacy errors require verification.
Deploy the database migration before the new handler. Core migration replacement
runs in one transaction so a repeated release cannot expose intermediate older
capacity definitions. If handler deployment fails, keep the queue held and fix
forward; do not restore old claim functions while unresolved attempts exist.

Required release checks include:

- SQL fixtures covering ownership rotation, expiry, late completion, source edits,
  same-result replay, explicit versus uncertain failures, admin authorization,
  verification, shutdown windows, audit, and actual service-role calls.
- Real PostgreSQL multi-connection tests for mixed admissions, 24 simultaneous
  provider starts, and claims racing a source edit.
- Worker tests for dropped acknowledgements, interrupted bodies, provider failures,
  cancellation, evidence validation, and unchanged successful workflows.
- Staging checks of the exact migration function bodies, signatures and grants,
  private ledger access, and live intake/reassessment workflows.
- Existing production account isolation, usage and live recruiter checks.

The production-readiness checks now add a simulated 40-second database outage,
real paid staging bursts, and scheduled operational monitoring; see
[production-readiness.md](production-readiness.md) for their gates and limits.
Still pending: a complete per-stage checkpoint state machine and circuit breakers.
Current recovery preserves safe ownership and can retry a saved completion, but
does not retrieve or reconstruct a provider response lost before persistence.
