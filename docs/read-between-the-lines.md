# Read between the lines

For the current role-neutral engine and automatic outcome learning, see [Experience intelligence](experience-intelligence.md). The notes below describe the initial inference release.

This release completes the October 6 inference commits. Inspection found a literal newline escape in the analysis handler, an inconsistent evidence-type schema, missing integration in reassessment, and three failing existing Node tests. These are corrected without rewriting saved assessments or approving scores.

## Evidence and fit

Intake, screening and durable reassessment receive bounded transferability hints derived from current-candidate source text. Relationships cover adjacent tools and component workflows, including messaging, testing, cloud infrastructure, security delivery and vulnerability management. Matching uses term boundaries, rejects explicit negation and aspiration, removes recognized evaluator instructions and collapses repeated terms. Every hint includes original excerpts and source IDs. Job requirements, approved lessons and generated profile summaries cannot produce a hint.

The model may identify additional job-related transfers, but must cite candidate evidence and explain the connection. Inferred findings are partial, never fully supported direct experience. Years of experience, mandatory direct tool usage and credentials cannot be inferred from adjacent tools. Missing evidence remains unknown; explicit contradictory evidence remains visible. The model considers partial transferable credit rather than counting missing keywords as proof of inability. The existing fit scores and weights remain distinct from evidence confidence and require recruiter approval.

Every finding has a provenance label, explanation, source citations and confidence. The server attaches exact contiguous source passages, using a relevant original excerpt; these are excerpts of the cited source, not a semantic proof that the model interpreted it correctly. For inferred findings the UI also shows the transfer explanation and a screening question.

Confidence is an explicit heuristic, **not calibrated accuracy or a hiring probability**. Model low/medium/high estimates start at 35/65/85. Unknown is capped at zero, profile-summary-only evidence at 35, weak known transfers at 40 and other inferred evidence at 70. Direct/contradictory source-backed evidence is capped at 85. Duplicating citations does not raise the cap. The aggregate is the mean of criterion evidence scores and includes unknowns; it does not alter fit. Labels use high >=80, medium >=50, otherwise low. Resume assertions are still candidate claims, not independent verification.

## Manager disagreement and approved learning

The candidate workspace has a manager-disagreement form with five reasons: overlooked transferability, overstated transferability, different priorities, corrected facts, or an unexplained decision. Save records the reason and manager's explanation as candidate-only feedback through the existing durable feedback path. It preserves the prior scores for context but does not apply new scores or change pipeline stage. Unexplained decisions cannot alone produce reusable lessons.

The next reassessment may propose an evaluation-method lesson for a validated relationship, or an explicit manager-priority lesson for this job. A recruiter must approve the exact lesson and scope. Existing workspace/job/role isolation, source revisions, invalidation, edit/withdrawal controls and audit snapshots remain enforced by the assessment-memory database functions. No automatic training, cross-workspace learning or promotion occurs. Existing assessments without the new fields are labeled as earlier assessments; rerun them to get the new findings.

## Validation and deployment

- Node regressions cover status/schema consistency, source validity, confidence caps, duplicated evidence, aliases, keyword collisions, explicit negation, prompt instructions, scope and unexplained disagreement.
- Authenticated handler and durable worker tests retain the existing source, quota, revision and lease coverage.
- Browser CI exercises direct/inferred labels, original citations, the confidence meter, mobile disagreement capture, unchanged scores and approved-memory lifecycle.
- The private production-model preflight adds adjacent messaging, secure-delivery workflow, explicit tool denial and unexplained manager disagreement to the six existing cases. All ten production-model cases must pass; historical baseline results are comparison only. Temporary synthetic users and the probe are cleaned up by the existing release workflow.
- Deployment uses the repository's staging, security/database, backend and publication gates. No schema migration is required. Rollback is a code revert; saved feedback and approved lessons remain intact.

Passing synthetic checks establishes behavior on those fixtures, not measured improvement across real candidate evaluations. Held-out recruiter-reviewed examples remain necessary to calibrate confidence or claim an accuracy gain.
