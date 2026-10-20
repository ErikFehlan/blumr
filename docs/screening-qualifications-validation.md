# Job intelligence and qualification matching — October 19, 2026

Continuation of PR #120 (`feat/rules-first-screening`). This milestone completes the shared qualification implementation requested before bulk-import/UI work. It is experimental until the release gates and production authorization are satisfied. No production deployment or merge is part of this milestone.

## What changed

The existing canonical Top 5, experience/date parser, source quotation controls, transferability relationships, capability workflows, approved manager-feedback records, authenticated screening route, and workspace-scoped caches are reused. There is no parallel recruiting architecture and no additional model request for compilation, matching, or feedback changes.

- Legacy priorities and recruiter edits compile deterministic requirements even without a generated `screening_rule`. Canonical title and explicit requirement changes in the edited reason replace obsolete bindings. Stale job-source priorities still require review.
- The rubric retains all five priorities plus explicit additional requirements and mandatory/preferred distinctions. Descending priority-order weights are visible. Explicit manager emphasis applies a bounded 2x product default, not an invented manager-supplied percentage.
- Job titles and equivalents provide relevance context. Qualification requires relevant work evidence. Title alone cannot establish experience depth, seniority, personal ownership, or management.
- Numeric experience is scoped to each capability. AND/OR and degree-or-experience alternatives are preserved. Relevant occupational periods use the existing interval union; overlapping jobs count once. Job tenure does not automatically become years using every tool listed. Partial dates, missing evidence and vague recency stay uncertain.
- Credentials preserve specific qualification names, degree fields, license jurisdiction, current/pending/expired status and a daily assessment date. Resume claims are explicitly **not independently verified**. Specific Azure credentials are not interchangeable.
- Practice, implementation, ownership, team exposure, people management, enterprise context, defined recency, supported team/budget quantities and existing full-workflow stages are distinct evidence checks. Required contributions do not demand sole ownership.
- True name equivalents are direct matches. Related tools remain partial transferable evidence unless the job explicitly accepts them as alternatives. Unknown occupations can use concrete work terms without a title whitelist.
- Job context and current, approved, job-scoped manager signals can emphasize priorities, clarify team scope, change mandatory/preferred status or explicitly revise an experience threshold. Latest approval state, source timestamp, job, workspace and candidate linkage are checked. Revoked, stale and candidate-only feedback cannot become shared qualification rules. Raw candidate feedback is never another candidate's evidence.
- Cache keys include source records, approvals, vocabulary, engine versions and assessment date. Source changes recompile and rescore. Protected traits and source instructions are excluded; unsupported language produces an unresolved finding and verification question.
- Required-qualification evidence bands precede weighted ranking. All candidates, near misses, conflicts and uncertainties remain reviewable. No rejection, candidate fit-score overwrite or employment decision occurs.

## Verification

Local: **344 JavaScript tests and 15 focused Deno tests passed**, including 22 new qualification regressions, one seven-occupation pool regression, and an authenticated approval/revocation cache test. Deno type checking is included. Existing security and priority-generation tests remain green; priority generation still makes one budgeted/accounted request in the mocked-provider test.

Seven invented pools cover cloud engineering, accounting, nursing, warehouse operations, education, industrial maintenance and QA. Each has five priorities and five candidates. All 28 expected pair orderings pass, all seven documented candidates rank first, transferable candidates remain in the configured near-miss set, and every returned quotation occurs in the source resume. These are explicit synthetic regression labels, **not a recruiter-labeled accuracy or false-negative study**.

Regressions include separate duration thresholds, overlapping employment, wrong-platform landing zones, team-versus-personal ownership, different license jurisdictions, pending/expired credentials, degree alternatives, unrelated people counts, pasted job requirements, prompt injection, protected-trait changes, recruiter edits and manager preference approval/revocation. Unfamiliar or ambiguous requirements remain visible for review rather than being declared satisfied.

`screening-qualifications-local.json` retains the prior two-rule CPU benchmark with the new evidence parser. `screening-qualification-pools-local.json` measures seven five-priority rubrics at 20/100/500/1,000 resumes. These exclude upload, PDF/DOCX extraction, HTTP, database, UI and model inference. They are load fixtures and local observations, not production latency percentiles.

The PR workflow repeats Node, Deno, PostgreSQL 17 permission/invalidation checks and authenticated staging. Staging tests use real private TXT objects and known extracted text, cold/warm 20/100/500/1,000-resume runs, plus all seven qualification pools. They assert zero provider ledger entries and zero queued paid assessments, remove disposable fixtures and disable the experimental flag afterwards. Hosted results are recorded after the run completes.

## Scope and remaining release evidence

The backend qualification milestone is distinct from the full #118/#119 delivery. Bulk PDF/DOCX/ZIP ingestion, UI progress and overrides, selected-finalist deep AI, Top 10 and batch spending controls remain future milestones. The existing default paid intake has not been replaced.

The language rules are intentionally bounded. Unsupported numeric scope or ambiguous recency remains unresolved; this is not universal natural-language understanding. License claims need external verification by the recruiter. Real, appropriately authorized recruiter-labeled pools and live job-priority generation quality remain required before a production accuracy claim. The route currently fails visibly at its 1,000-record manager-history bounds; larger feedback histories need a paginated/current-state query before rollout to such jobs. Model token savings and production invoice savings have not been measured. Initial rules scoring uses zero provider calls; the separate job-priority generation request and future finalist analysis are not free.

The first hosted attempt on `3c0a462` completed load screening but stopped when subsequent occupation fixtures exceeded the existing 1,000-candidate workspace quota. Cleanup and flag disablement passed. The fixture sequence now removes the completed load-test data before creating occupation pools; application quotas are unchanged. Final hosted results are recorded in PR #120 and its workflow artifact.
