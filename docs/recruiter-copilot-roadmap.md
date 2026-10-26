# Recruiter Copilot: repository audit and implementation roadmap

Audit date: October 26, 2026. Baseline: `168e0195604845f923ffc946b6c3bae3d5960c73` on `main`. Epic: [#123](https://github.com/ErikFehlan/blumr/issues/123).

## Recommendation

Extend the existing product. The screening foundation is already implemented and released; the largest MVP gaps are a complete screening-preparation brief, strong-answer guidance, structured intake assistance, and reusable interview-preparation outputs. Begin with backend-owned batch spending limits and removal of recruiter budget controls (#124), then extend existing assessment and job-intelligence outputs.

The current JavaScript SPA, Supabase functions, PostgreSQL, private Storage, and durable worker system can support this MVP. There is no demonstrated need for a C#/SQL Server migration before it. Keep [#122](https://github.com/ErikFehlan/blumr/issues/122) separate, with contract tests providing a future migration seam.

## Audit scope and evidence limits

Reviewed the repository inventory, application entry points and feature modules, shared screening and evidence code, authenticated analysis routes, job/refinement and reassessment services, database migrations and permissions, deployment/structural-parity scripts, benchmark reports, tests, and the current issue/PR backlog. No `AGENTS.md` was present in the checkout. Baseline local `node --test tests/*.test.js`: **501 passed, zero failed**.

This is a source-backed engineering assessment, not a fresh production security audit or live performance certification. Runtime flags, installed database definitions, provider billing and real-user adoption were not remeasured. Release claims below are attributed to the existing release record.

Issues #118 and #119 are closed and record release through PR #120 on October 20. Some repository documents retain earlier “not deployed” paragraphs; later release entries and the closed issues supersede those historical statuses. Open items #35, #104 and #121 also describe work that now partially exists. Do not create replacement tickets for their remaining scope. PR #117 proposes additional durable cost accounting; assess it against current main before incorporating it.

## Current state assessment

“Completed” means the named implementation is present, not that every new commercial target is achieved.

| Capability | Classification | Repository evidence and remaining work |
| --- | --- | --- |
| One canonical Top 5 priorities | Completed | `refine-job-criteria/priorities.mjs`, `assets/job-wizard.js`, unified-priorities migration. Source-bound, editable priorities already exist; extend this contract. |
| Job Intelligence and reusable rules | Completed | `_shared/job-intelligence.mjs`, `screening-engine.mjs`, `screening-requirements.mjs`, `screening-qualifications.mjs`. Versioned, provider-free compilation, evidence depth, qualifications and role aliases. More representative calibration remains ongoing. |
| Bulk PDF/DOCX/DOC/TXT/ZIP import | Completed | `assets/bulk-files.js`, `bulk-screening.js`, `_shared/bulk-screening.ts`, bulk migration. Dedupe, source retention, recovery and per-file outcomes. Saved work persists; unsaved originals must be reselected after reload. |
| Rules Top 20 → selective deep AI → Top 10 | Completed | Same bulk modules and existing reassessment/intake worker. Explicit finalist selection, near misses, provisional/final states and no initial full-AI fanout. |
| Individual/bulk consistency | Partially completed | Individual rules requests and bulk scoring use shared Job Intelligence and scoring modules; individual assessments and bulk finalists reuse the assessment worker. They are distinct stages, not identical numeric scoring systems. Add cross-path contract fixtures and measured parity (#125). |
| Evidence reuse and invalidation | Completed | Screening rubric/candidate caches, source hashes, revision-bound consent, shared exact-quotation validation, idempotency and worker leases. Validate new output contracts against these keys. |
| Evidence interpretation and verification | Partially completed | `transferability.mjs`, `screening-evidence.mjs`, `experience-intelligence.mjs`, criterion/priority findings, confidence and unknown/contradictory labels. No complete recruiter verification brief or structured confirmation lifecycle yet (#126, #131; reuse #104). |
| Screening questions | Partially completed | Assessment schemas already include questions; candidate workspace displays two concise questions. Extend to roughly 5–7 with purpose, source/priority and strong-answer guidance (#126). |
| Job intake Copilot | Partially completed | Code-first criteria and canonical priority questions exist. Add an intake brief, required/preferred clarification and sourced contradictions (#127). |
| Candidate submission Copilot | Partially completed | `candidate-workspace.js`, `presentation.js`: supported summaries, editable saved drafts, preview and copy already exist. Add email composition, separate concerns and candidate-specific interview preparation (#128). |
| Candidate comparison | Completed | `decision-workspace.js`: two to four candidates against shared priorities, evidence, saved/proposed/stale states. Connect it to Copilot actions (#130). |
| Daily action center | Partially completed | `home.js`, actionable notifications and review queues already surface ready/failed work, open jobs and submittals. Extend screening/follow-up actions; do not build another dashboard (#130). |
| Shortlist workspace | Partially completed | Existing top/near-miss/all lists, selection, reordering, deep review and comparison. Simplify layout and complete consistent approval/export paths (#130). |
| Boolean generator | Not started | No platform-aware Boolean generation module found. Build deterministic adapters using shared vocabulary and priorities (#129). |
| Job feasibility intelligence | Not started | No dedicated feasibility brief found. Start with evidence-backed internal contradictions and clarification, not unsupported market-supply claims (#127). |
| Scoped learning | Partially completed | `assessment-memory.js`, memory/automatic-role-knowledge/inference migrations: approval, editing, withdrawal, source invalidation, job/role scope and client-bound historical preferences. Extend structured outcomes and reconcile automatic-pattern behavior with the initiative's approval requirement (#131). |
| Context-sensitive Copilot panel | Not started | Existing candidate details and job wizard are natural insertion points. Use one contextual disclosure rather than another full tool grid (#130). |
| Batch AI spending governance | Needs refactoring | `create_screening_batch` accepts a member-supplied budget; `update_screening_budget` permits members to raise it; recruiter UI exposes both. Existing atomic reservations and quotas should be retained (#124). |
| Cost reporting and profitability evidence | Partially completed | Model rates, provider usage, batch cost/reservations and workspace/global quotas exist. Durable attribution/coverage has pending work in #117; no proven $49-plan margin or 40% saving versus a measured comparable baseline (#125). |
| Mail/calendar/ATS integration | Not started for general Copilot workflows | Onboarding email/reminder machinery exists; it is not a Gmail/Outlook inbox/calendar integration. Reuse #121 for authorized import research and #35 for reminder follow-up. |
| Enterprise foundation | Partially completed | Workspaces, memberships, team roles/plans, RLS, private Storage, audit/recovery and account export/deletion exist. Enterprise SSO and complete retention/organization governance need separate adoption-gated scope. |

Paths without a directory prefix in backend rows are under `supabase/functions/` or `supabase/migrations/` as appropriate.

## Architecture gap analysis

| Layer | Reuse | Extend/refactor | New justified component |
| --- | --- | --- | --- |
| Job understanding | Canonical priority draft/review, code-first criteria, shared Job Intelligence | Source/version-aware intake and ambiguity outputs; current requirements remain authoritative | Small intake-brief contract, not another priority engine |
| Candidate intelligence | Evidence findings, source excerpts, existing questions and shared workers | Add preparation fields and reusable verification states without duplicating assessment | Provider-independent preparation/composition module with bounded schemas |
| Persistence | Workspace/job/candidate IDs, current drafts, approval/version guards | Version preparation artifacts by source + job/priorities + approved context + output schema; preserve recruiter edits and signal stale output | Additive preparation storage only if existing records cannot represent editable artifact types cleanly |
| AI admission | Existing queues, leases, quotas, reservations, usage/model-rate accounting | Route any genuinely new reasoning through the same admission path; retry only under existing idempotency constraints | No new queue or model proxy for MVP |
| Presentation | Candidate workspace, job wizard, comparison, Home, submittal preview | Extract small action/composition modules from `app.js`; keep context actions progressive and maintain focus during polling | Context-action registry/view; no SPA/framework rewrite |
| Sourcing | Shared role aliases, capability vocabulary, job criteria | Explicit search groups and sensitivity settings; verify target platform syntax | Deterministic Boolean adapters |
| Learning | Approved lessons, automatic knowledge, outcome/correction history | Explicit scope/provenance, confirmed qualification outcomes, reversible explanations; review automatic promotion gates | Stable manager identity only if actual cross-job requirements justify it |
| Integrations | Existing supported file intake and communication consent patterns | Provider authorization, per-tenant tokens, reconnect/revoke, audit and user-approved actions | Later thin adapters feeding current contracts |

Technical debt that affects delivery: `assets/app.js` is roughly 191 KB and several UI modules combine state, HTML and asynchronous work. Deployment scripts explicitly enumerate migrations, and structural-parity checks compare exact function source/permissions. Every additive backend change must update those paths, or a later release can restore an older function. Test dependencies are largely installed in CI rather than a root lockfile; preserve exact runtime versions and document local differences. Historical docs/backlog need status reconciliation before implementation decisions.

Avoid wholesale refactoring. Extract a module only when the next feature needs a stable boundary. Keep score calculation, candidate evidence, recruiter edits, historical context and communication drafts as distinct contracts.

## Prioritized backlog and dependencies

| Phase / priority | Task | Dependencies and measurable exit |
| --- | --- | --- |
| 0 / P0 | [#124: Backend-owned batch budgets](https://github.com/ErikFehlan/blumr/issues/124) | First task. Member/foreign/anonymous bypass tests fail closed; admin changes are scoped; replay/limits intact; no budget form in recruiter flow. |
| 0 / P0 | [#125: Parity and measured baselines](https://github.com/ErikFehlan/blumr/issues/125) | #124 for new budget contract; coordinate #117. Record workload/version/cost coverage and repeatable before/after measures. |
| 1 / P1 | [#126: Screening and verification brief](https://github.com/ErikFehlan/blumr/issues/126) | #125 contracts. 5–7 grounded questions when enough evidence exists; strong-answer guidance, edits and stale-state handling. |
| 1 / P1 | [#127: Intake and feasibility](https://github.com/ErikFehlan/blumr/issues/127) | #125 contracts; may progress alongside #126. One priority list; source-linked clarification; no silent criteria changes. |
| 1 / P1 | [#128: Submission and interview preparation](https://github.com/ErikFehlan/blumr/issues/128) | #126. Evidence-only outputs, separate private concerns, editable persisted draft, no auto-send. |
| 2 / P2 | [#129: Boolean drafts](https://github.com/ErikFehlan/blumr/issues/129) | #127. Tested broad/balanced/targeted adapters; supported syntax; zero AI calls for conversion/copy. |
| 2 / P2 | [#130: Cohesive actions and shortlist](https://github.com/ErikFehlan/blumr/issues/130) | #126–#128, then #129. One end-to-end flow, current action queues, approvals/export, desktop/mobile evidence. |
| 3 / P2 | [#131: Qualification outcomes and scoped learning](https://github.com/ErikFehlan/blumr/issues/131) | #125–#127 and existing #104. No cross-client rule leakage; provenance/withdrawal and held-out evaluation. |
| 4 / later | Authorized integration adapters | Existing #121 and #35; MVP adoption first. Validate provider support and consent before development; connected tokens are tenant-scoped; external actions require recruiter review. |
| 5 / later | Enterprise administration and controlled automation | Pilot evidence and measured capacity first. Reuse existing team controls; scope SSO, retention and auditable approvals separately. |
| Separate | [#122: Custom backend](https://github.com/ErikFehlan/blumr/issues/122) | Benchmark/business case, auth/data migration and rollback plan; not on the Copilot critical path. |

## Six-week implementation plan

Planning dates are targets for a focused engineering stream, not delivery guarantees. The scope is the MVP plus a bounded Phase 2 pilot, not all five phases.

| Week | Engineering work | Completion criteria |
| --- | --- | --- |
| 1: Oct 26–Nov 1 | #124; establish #125 contracts and baseline report; review #117 overlap; record existing production release evidence | Reviewed change with passing local/CI permissions and browser checks; no client-set budget; versioned parity/quality/latency/cost protocol and explicit gaps. |
| 2: Nov 2–8 | #126 preparation composer/schema and candidate-context UI; reuse stored evidence/questions | Roughly 5–7 distinct questions where supported, each with purpose, priority/source and strong-answer guidance; unknown ≠ absent; reopening/copying adds zero model calls; isolated draft persistence and tests. |
| 3: Nov 9–15 | #127 intake/feasibility; complete editable artifact persistence/versioning | Canonical priorities remain singular; every flag cites job language; accept/edit is explicit; sparse/contradictory jobs and stale artifacts behave correctly. |
| 4: Nov 16–22 | #128 supported submittal/email/interview preparation; #129 deterministic Boolean pilot | Recruiter can edit/save/preview/copy all outputs; no invented credentials or private-note leakage; broad/balanced/targeted strings validate on the selected platform contracts. |
| 5: Nov 23–29 | #130 unified contextual actions and Home/shortlist work; bounded #131 scope review | Intake → shortlist → screen prep → approved draft journey passes desktop/mobile tests; no duplicate analysis; scoped learning gaps and approval behavior documented. Holiday availability may reduce capacity. |
| 6: Nov 30–Dec 6 | Regression, isolated load/recovery/security validation, consenting recruiter pilot, compare to week-one baseline | Publish actual outcomes, remaining risks and release checklist. Deploy only after explicit approval and existing release gates. Defer any feature that fails grounding, privacy, reliability or cost acceptance. |

Safe parallel work opportunities after contracts settle: intake composition and candidate preparation; Boolean adapters and submission formatting; synthetic fixture labeling and UI validation. Shared migrations, assessment schema and deployment scripts should have one coordinated change owner. This plan does not require spawning additional agents or concurrent production changes.

## Measurements and commercial targets

Historical #118 release notes report a mixed hosted batch of 500 unique synthetic resumes: 143 ms UI acknowledgment, three cached rankings at 1.037–1.268 seconds, zero initial screening provider calls, 20 deep assessments and a $0.6960888 token-based cost estimate. These are historical observations, not current production p95 guarantees. Full imports and deep assessments took minutes. A 500-to-20 selection means 96% fewer initial assessment requests arithmetically; it does not prove 96% invoice savings.

The user already confirmed independent recruiter-reviewed accuracy acceptance on October 20. Preserve that acceptance. No labeled dataset, sample count or error-rate report accompanied it, so it does not establish a publishable accuracy percentage. Future quantified studies should extend the evidence, not re-request the same acceptance.

| Measure | Baseline and proposed gate |
| --- | --- |
| Screening preparation time | Time the same recruiter tasks before/after; paired roles/candidates; report sample size and median/distribution. Initial target: ≥30% reduction. |
| First qualified shortlist | Start at authorized file selection; qualification judged against the job rubric by recruiters. Separate first useful/provisional list from final Top 20. Initial target: ≈50% reduction. |
| Deep evaluation cost | Actual input/output/cache tokens and verified model prices per completed, comparable assessment; include retries/unsettled coverage. Initial target: ≈40% reduction from measured baseline. |
| Accuracy/grounding | Qualified-candidate recall, precision@20, near-miss rescue, unsupported claims, source-link correctness and inter-reviewer disagreement; holdouts excluded from learning. No aggregate “accuracy” from synthetic pass counts. |
| Latency/reliability | Repeated 20/100/500/1,000-file mixed workloads, concurrent users, interrupted upload/worker recovery; sample counts with p50/p95 and errors. Set enforceable SLOs only after observations. |
| Margin | At $49 Pro revenue, subtract variable provider, parsing, storage/egress, hosting allocation and support assumptions for light/typical/heavy use. Track feature/workspace attribution and rate coverage; token estimates are not provider invoices. |

## Risk assessment

| Risk | Consequence | Mitigation / release condition |
| --- | --- | --- |
| Unsupported or overconfident guidance | Recruiter treats a resume mention or inferred skill as proven | Exact sources, neutral verification wording, unknown/contradictory distinction, recruiter-editable outputs, representative review. |
| Duplicate or uncontrolled AI | Unprofitable subscription and repeated work | Backend budgets (#124), shared admission/cache keys, no generation on render/copy, durable accounting review (#117), per-feature/workspace cost coverage. |
| Serial upload and provider latency | Large pools feel blocked despite fast ranking | Preserve useful progressive results; profile actual bottlenecks before raising concurrency; retain quotas and bounded memory. |
| Async UI/draft conflicts | Lost edits or candidate/job mix-ups | Source IDs/version guards, save-before-switch semantics, stale labels, scope and browser regression tests. |
| Learning scope drift | One client's preference affects unrelated jobs | Extend existing scope/invalidation, audit automatic reuse, exact lesson provenance, reversal and cross-client negatives. |
| Candidate data exposure | Cross-tenant disclosure or private notes in client drafts | Existing RLS/private Storage/authorized source reads, least-privilege RPCs, escaped UI, explicit output audience and security tests. |
| Integration assumptions | Unsupported access or accidental communications | Authorized APIs/exports, provider-specific feasibility checks, draft-first actions, approval before sending; no disguised automation. |
| Deployment script drift | A later release overwrites safeguards | Wire migration ordering and exact function source/permission parity into existing workflows; test repeated application. |
| Premature scale/migration scope | Copilot value delayed by infrastructure work | Keep #122 and enterprise scope separate; use measured saturation and adoption to justify changes. |

## First implementation and review boundary

Implement #124 on `feat/recruiter-copilot-foundation`: server assigns the existing $5 default to new imports, member-provided budgets become non-authoritative, and cap increases require an authenticated application admin with access to the batch. Existing saved caps are preserved. Remove budget editing and internal provider-reservation accounting from the recruiter screen while retaining backend accounting, quota checks and explicit finalist selection. A cap edit alone must not enqueue work.

Use local synthetic SQL/browser tests and existing PR checks. No production data, scores, rollout flags, provider settings or deployed code are changed by this branch. A later approved deployment must pass the existing staging/release gates. Implementation validation is recorded in the pull request and `screening-budget-governance.md`.
