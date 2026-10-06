# Experience intelligence v2

The assessment accepts any occupation's actual job requirements. The starter workflow examples cover sales, finance, recruiting, customer success, marketing, care coordination, teaching, projects, process improvement, maintenance, quality, inventory, administration and technology. They are examples, not an occupation whitelist. Unlisted workflows still use the existing model call and original candidate evidence.

## Five capabilities

1. **Experience depth:** code attaches source-linked actions labeled exposure, team exposure, contribution, practice, implementation or ownership. These describe responsibility, not a universal ranking. Titles, keyword lists and generated summaries cannot establish personal ownership.
2. **Workflow reasoning:** connected, substantive activities in the same documented engagement can suggest a workflow. At least two distinct activity excerpts are required; missing stages remain explicit and inferred support stays bounded. Licenses, credentials and required direct experience cannot be supplied by inference.
3. **Career context:** explicit consulting employer/client relationships are retained. Overlapping month-precision periods count once; year-only dates stay incomplete. Employment periods do not prove skill duration. The app does not infer age or penalize gaps or consulting status.
4. **Questions:** at most two unresolved requirements are prioritized using explicit required qualifications, stated hiring priorities, contradictions and uncertainty. Supported requirements are not asked again. Recruiters use the same screening notes; no new required form or approval is introduced.
5. **Outcome learning:** private triggers record future server-produced partial inferences and compare them with later original human confirmations or contradictions. Earlier notes, recycled summaries, bare hiring decisions, ambiguous negatives, questions and hypothetical statements do not label predictions. Source edits/deletions rebuild the labels.

## Learning boundaries

Candidate-level deterministic holdouts comprise approximately 20% of predictions. They are excluded from inference-history reuse and the older automatic catalog, while their aggregate results remain visible separately in the existing optional learning panel. This is observational evaluation of inferred capabilities, not calibrated hiring-success prediction.

History must match workspace, role/seniority, exact normalized requirement and inference kind. Reuse requires six labeled candidates, two jobs and three distinct excerpts within 180 days. Below 50% confirmation, evidence confidence is capped at 35. At least 12 candidates, three jobs and 80% confirmation can add 10 points, capped at 70, only with substantive current candidate evidence. These thresholds are conservative heuristics, not established accuracy estimates. Code never rewrites JD or Manager Fit from historical counts.

New or edited jobs snapshot at most six applicable entries using the existing memory lookup. History growth does not enqueue other candidates. Changed counts, contradictions, source deletion, expiry or scope changes invalidate stale history; optional exclusions remain available. Predictions are future-only, so initial real outcome metrics will be empty.

## Calls, validation and release

Depth, workflows, chronology, questions and learning run in code around the existing model calls. Prompt context is bounded; routine provider-call count and required clicks are unchanged, although input tokens can increase modestly. Quality display adds a small database lookup.

Cross-role Node fixtures, native PostgreSQL regressions and browser checks cover provenance, scope, holdout separation, source invalidation, questions and existing workflows. Live synthetic checks exercise learning with zero AI usage events. The existing release preflight has 14 production-model cases, including care, sales, maintenance and consulting. Synthetic checks establish behavior on those cases; real improvement must be measured as independent evidence accumulates.

Release uses the existing staging/backend/browser gates and additive private-schema migration. No old assessments are rewritten or automatically reprocessed. Disabling `blumr_knowledge.for_job` reuse through a migration stops automatic context without deleting candidate evidence or historical predictions.
