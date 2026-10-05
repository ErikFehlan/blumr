# blumr hardening phase 2

Started October 5, 2026 from the hardening recommendations. New product features are paused while reliability and hardening take priority. This extends the
existing reliability work; the twelve recommendations below are not all complete.

## First increment: shared assessment admission

The durable intake and reassessment queues already serialize their own claims,
but their limits were independent and direct analyses bypassed those limits.
The new migration gives all three claim functions one transaction-scoped lock.

- At most three active reservations per workspace across those routes.
- At most six active reservations across the application, preserving the previous
  combined durable capacity of two intakes and four reassessments.
- The intake limit of two and reassessment limit of four still apply; one
  reassessment dispatch still claims at most two tasks.
- Excess durable work remains queued without spending an attempt or reserving
  model budget. A full workspace does not prevent a global claim from selecting
  another workspace's work. This is a capacity bound, not strict fair scheduling.
- New direct requests receive HTTP 429, `assessment_capacity`, and a ten-second
  retry hint without creating a claim or invoking AI. They are not persisted as
  queued work. Existing identical requests can still wait for or replay a result.
- An expired direct claim whose provider started retains its capacity reservation
  until completion or the existing verified admin recovery. An expired owner
  cannot reacquire ownership just by reusing its claim ID.
- Claim functions and the capacity counter are service-only, security invoker
  functions. No resume text or candidate identifiers are exposed by rejection.

The existing core deployment script installs the migration in staging and
production. The SQL fixture verifies role permissions, mixed routes, exhausted
capacity, result replay, and expired direct ownership. The multi-connection test
launches 24 calls for one workspace and 36 mixed-workspace calls against real
Postgres; it does not call an AI provider. Both PR and release checks run it.

Staging parity compares the four changed routines against this commit's migration
source, including body, signature, defaults, language, return type, execution mode,
search path, and role permissions. Other production structure must still match.
This allows intentional staging-first changes without ignoring function drift.

### Boundaries and remaining work

The durable worker recovery increment below replaces the original lease-only
reservation behavior. These remain admission controls, not a provider-side
exactly-once guarantee. Criteria refinement and other non-assessment model calls
retain their existing budget controls and do not use this gate. Six reservations
is a conservative starting configuration, not proof of capacity for 1,000 users.

## Second increment: durable worker recovery

See [durable worker recovery](durable-worker-recovery.md) for the protocol,
recovery procedure, tests and deployment boundaries. Intake and reassessment
attempts now survive source changes, renew bounded leases, fence each provider
start, retain ambiguous reservations and reject stale results. Unstarted expired
work retries automatically. Started work with an unknown outcome requires audited
admin verification; transient result-save failures retry the same save.

The proposed per-stage workflow is upload → validate → parse → normalize → create
job → evaluate → validate output → persist → notify. Its finer-grained persisted
state transitions and resume-level checkpoint recovery are still pending.

## Recommended work remaining

1. Capacity validation under realistic assessment bursts, including the operational
   effect of reservations held for verified recovery.
2. Explicit per-stage assessment state machine and checkpoint recovery.
3. Tenant-isolation tests across every data and file access path.
4. Server-side authorization audit.
5. Secure file-upload pipeline.
6. AI prompt-injection tests for untrusted resumes and job descriptions.
7. Strict AI output/schema validation across every route.
8. Circuit breakers and dead-letter/recovery queue.
9. Usage quotas and abuse protection. Proposed limits include 10 MB per resume,
   10 resumes per minute, and 50,000 characters per job description; audit existing
   constraints and user workflows before changing them.
10. Versioned assessment/audit history including prompt, scoring, model,
    requirements and manager-feedback versions.
11. Synthetic end-to-end monitoring.
12. Shadow evaluation for scoring/model changes.
