# Assessment reasoning and approved memory

Candidate assessments now use medium reasoning on the existing Sol routes. Short feedback interpretation retains `none`. Initial intake and screening reserve 6,000 output tokens; the single intake repair and reassessment reserve 8,000. Reasoning and visible output share that bound. Existing workspace/global quotas and the 8,000-token per-call security limit remain enforced. Provider calls time out after 90 seconds and durable workers retain their existing leases.

The model produces concise findings for each supplied requirement, a classification and explanation of feedback impact, and references to any approved lessons it applied. Unknown evidence remains distinct from contradictory evidence. Existing scores are comparison points, not evidence; repeated facts and bare advance/reject decisions should not change scores. Scoring still requires the existing human approval. These findings are evidence summaries, not private chain-of-thought.

Reassessment reads the original saved resume as well as feedback and approved context. Exact quotations are verified against the supplied source. Reviewed assessments retain their structured findings in the saved assessment record; a recruiter correction retains the preceding assessment and scores.

## Memory lifecycle

Reassessments may suggest up to two lessons supported by candidate feedback or an explicit recruiter correction. The suggestion alone has no effect. The recruiter approves the visible text and scope:

- `manager_priority`: this job only; informs Manager Fit without changing JD requirements.
- `evaluation_method`: this job, or jobs with the same normalized title in the same workspace. Same-title matching is deliberately conservative; it is not semantic role matching. Methods explain how to read evidence, not what qualifications another job requires.

The `assessment_lessons` table records the approver, source revision, source IDs, source snapshot, scope and revision. Raw candidate observations are not copied into other candidates' prompts. The worker retrieves only active applicable lessons (job-specific first, then most recently updated, at most 12). The authenticated endpoint independently retrieves server-approved lessons with the caller's JWT and rejects browser-supplied approval claims. Changing or withdrawing a lesson queues affected open jobs; editing/deleting its source invalidates it and refreshes affected tasks. Candidate/job deletion cascades the corresponding lessons.

The Feedback page exposes approved memory for editing or withdrawal. Edited lessons require a fresh explicit save/approval and optimistic revision match. Source changes require a new assessment suggestion; an old source cannot be silently reactivated. No automatic fine-tuning, training export, cross-workspace reuse, or model promotion is added.

## Validation and release

- `node --test tests/*.test.js`: context scope, source validity, no invented citations, no scoring from memory alone, escaped explanations, and original-resume inclusion.
- Deno handler tests include `tests/assessment-memory-routing.test.ts`: caller-bound lookup, foreign-job denial, quota reservation, and forged browser-memory rejection.
- `tests/assessment-memory.sql`: real PostgreSQL semantics for approvals, role/job/workspace scope, invalidation, atomic edits, source deletion, unchanged candidate scores, and repeated migration application. It also runs the existing core intake transaction tests. Locally this can run in PGlite; CI runs PostgreSQL 16.
- `tests/assessment-memory-browser.cjs`: unchanged-score explanation, explicit role approval, edit/reload/withdrawal, and theme/mobile behavior. Existing resume and assessment journeys remain in CI.
- The private release preflight compares synthetic confirmation, contradiction and learned-ownership cases in addition to existing fixtures. All six production-model cases must pass. Historical baseline failures are recorded as comparison failures, not treated as production-model success or as a release gate. Confirmation must not inflate scores; newly contradicted ownership must affect its assessment; a relevant approved method must be applied. It executes before deploying production assessment handlers and cleans up its private probe afterward.

Mocked contract tests and synthetic release checks do not establish improvement on real hiring work. Before claiming measured accuracy gains, reserve separate, recruiter-reviewed cases across jobs; compare unsupported claims, repeated correction rate, requirement coverage, score stability under duplicate feedback, latency and token cost. Keep held-out cases out of the lesson memory used for that evaluation. Promotions must be based on evidence quality, not simply agreement with a rejection decision.

Deployment order is additive database migration, then backend functions, then frontend. The existing core deployment reapplies the memory migration after the legacy core functions so later deployments cannot accidentally discard memory retrieval. Rollback can restore the previous assessment code without deleting reviewed memory; inactive or unused memory remains private. No scores are bulk rewritten by installing the migration.
