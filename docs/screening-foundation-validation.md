# Rules-first screening integration — October 19, 2026

Development branch: `feat/rules-first-screening`, PR #120. No production deployment authorized or performed. Issues #118 and #119 remain open.

This is the historical first-integration report. The subsequent [qualification milestone](screening-qualifications-validation.md) supersedes its conservative blocks on numeric experience, credentials, recruiter edits and manager context. Its latency observations remain historical measurements.

## Assessment and implementation sequence

Reuse the existing static frontend, canonical hiring-priority drafts, source quotation controls, transferability relationships, durable intake/reassessment workers, provider budgeting and workspace RLS. The existing paid resume intake still runs a full AI assessment; this milestone does not change that default. PR #117 independently contains accounting fixes and has not been merged into this work.

1. Connect canonical priorities to source-grounded rules and validate their behavior (this milestone).
2. Validate authenticated reusable screening, source invalidation and durable caching (this milestone).
3. Obtain recruiter-labeled, representative pools; test generated rule completeness, equivalents, numeric experience, credentials, scope, manual priority edits and manager feedback. Current conservative review gates intentionally block incomplete rubrics.
4. Extend the durable intake pipeline with batch manifests, PDF/DOCX/ZIP extraction, deduplication, retries, incremental ranking and recruiter overrides. Ordinary bulk intake must not schedule one paid assessment per applicant.
5. Add reviewed-finalist selection, atomic batch spending reservations, cached deep assessments and the separate Top 10. Integrate the existing evidence UI, preserve the Top 20, and measure real upload/UI timing.
6. Run release checks and seek production deployment authorization only with concrete release evidence.

## Implemented

- Feature flag `RULES_FIRST_SCREENING=true` adds structured rules to the existing priority-generation call. No separate job-interpretation call; the default flag is off. Draft fingerprints distinguish the new prompt/schema version.
- Rules are AND groups of OR alternatives grounded in the cited JD passage. Invalid rules cannot invalidate an otherwise useful priority list; they become visible review work. Recruiter edits invalidate rules bound to old wording. Missing rules never trigger an automatic paid regeneration.
- Shared job intelligence uses canonical priorities and an explicit `priority_order_v1` weighting policy: descending integers by priority order, normalized over all priorities. These are product defaults, not claimed hiring-manager numerical weights. Titles alone supply no qualification score.
- Existing related-technology relationships remain inferred evidence. Explicit source alternatives remain direct alternatives. Numeric experience, credentials and scope are not proved by term matches. Additional criteria, knockouts and unstructured manager notes require review rather than being silently omitted from a complete rubric.
- Existing authenticated `analyze-patterns-beta` route accepts `analysis_type: rules_screening`, `job_id`, and 1–100 unique `candidate_ids`. One candidate and a batch use the same implementation. It reloads canonical job, priority and resume records using the caller JWT and ignores client-supplied scores, resumes, priorities and completion flags.
- The route always labels its requested subset provisional. It returns top candidates, near misses, every remaining candidate, document-attention cases, source evidence, timing and zero-provider-call metrics. No candidate is rejected and no existing candidate fit score is overwritten.
- One current rubric cache per job and one score cache per candidate bound retention. Version keys include job, priorities, feedback revision, engine version, rule contract and relationships. A changed resume hash, latest document, or rubric misses the score cache. Cache hits omit full resume text from the database response. All caches are workspace scoped, client read-only and cascade on source deletion.
- Fixed term-local negation and retained the strongest/contradictory evidence even after many earlier mentions.
- A shared pool coordinator sends two 100-candidate requests concurrently, immediately reports provisional progress, combines every page, and settles in-flight requests on errors/cancellation. A changed rubric, missing candidate or failed page cannot become a complete ranking. Completion describes only the explicitly requested candidate snapshot; unreadable documents keep the ranking provisional. It is ready for frontend integration; actual browser acknowledgment time has not been measured.
- The cache migration is included in the normal core-backend release sequence. Deployment remains behind existing release checks and explicit production authorization; installing the schema does not enable the feature flag.

## Local verification

- 321 JavaScript tests passed (312 pre-existing plus 7 new integration/accuracy regression tests and 2 pool-coordination regression tests).
- 14 focused Deno backend tests passed, including four new route/generation tests. The rule-generation test uses a mocked provider and verifies one accounted request, not live model quality.
- Deno type checks passed for the authenticated route and priority worker.
- Actual migration executed twice on local embedded PostgreSQL 17 (PGlite 0.3.14); `tests/screening-cache.sql` passed. Tests cover foreign-workspace/job/candidate access, read-only cache permissions, anonymous denial, request limits, changed text/rubric, newer documents, cross-candidate FK integrity and deletion cleanup. CI repeats against PostgreSQL 17.
- Synthetic matching examples cover cloud engineering, accounting, patient assessment, inventory, teaching and maintenance. These are regression fixtures, not a recruiter-labeled precision/recall study.

Raw CPU measurements are retained in `screening-local-before.json` and `screening-local-after.json`. Same Node v24.19.0 environment, 12 samples per size, synthetic ~2.5 KB text, two rules. No PDF/DOCX extraction, storage, HTTP or model inference. Runtime scheduling noise is visible; these do not establish production percentiles or a general speedup.

| Pool | Before cold p50 ms | After cold p50 ms | After pre-parsed p50 ms | Model calls |
| --- | ---: | ---: | ---: | ---: |
| 20 | 9.84 | 8.36 | 0.94 | 0 |
| 100 | 25.66 | 15.76 | 2.75 | 0 |
| 500 | 79.24 | 100.19 | 15.32 | 0 |
| 1,000 | 157.96 | 132.74 | 16.31 | 0 |
| 2,000 | 434.42 | 364.58 | 51.66 | 0 |

The extra evidence checks were slower for the 500-resume cold run. Do not advertise an across-the-board performance improvement. Cached database results reduce repeated parsing and full-text transfer; hosted timings must measure their practical effect.

## Hosted validation

Workflow `Validate rules screening foundation` runs the SQL and backend gates, then deploys only to the existing staging project. Its provider-free smoke uses disposable authenticated users and 20/100/500/1,000 stored synthetic text resumes, exercises cold/warm reads, foreign-workspace denial, forged input, changed content, and verifies zero provider ledger entries and zero queued paid assessments. It removes fixtures and disables the flag afterwards. No production resources are changed.

Completed successfully on October 19, 2026. The final measured code is `ea69bb4ec8b9546cb792033a382c23335b8880af`; [staging and screening CI run](https://github.com/ErikFehlan/blumr/actions/runs/39252097199). Cleanup passed and the experimental flag was disabled. No fixture assessments were queued and the provider usage ledger contained zero calls.

The initial benchmark used very short phrases. It was replaced with 2,173–2,224-byte synthetic resume-shaped documents and six evidence archetypes: direct practice, an explicit JD alternative, keyword-only mentions, transferable technologies, unrelated work, and explicit missing experience. The hosted assertions check their relative order and preserve explicit contradictions. This is still synthetic evidence testing, not a recruiter-labeled quality study.

The baseline below sends 100-candidate pages sequentially; the updated coordinator uses two concurrent requests. Both use the same authenticated screening backend, matching rules, fixture generator and hosting project. These are separate runs, not controlled production percentiles. Each size has one cold and two warm observations. Raw measurements are in `screening-staging-before.json` and `screening-staging-after.json`.

| Pool | Sequential cold s | Concurrent cold s | Sequential warm s | Concurrent warm s | Concurrent first warm result s |
| --- | ---: | ---: | ---: | ---: | ---: |
| 20 | 2.44 | 2.65 | 0.85–0.92 | 0.96–1.09 | 0.96–1.09 |
| 100 | 1.49 | 1.82 | 0.80–1.26 | 1.07–1.09 | 1.07–1.09 |
| 500 | 7.09 | 4.53 | 4.23–4.89 | 2.23–2.66 | 0.84–1.00 |
| 1,000 | 12.81 | 6.30 | 8.28–8.62 | 4.17–6.70 | 0.72–0.83 |

Warm runs hit the cache for every candidate. All observations used zero provider calls. The 500-candidate cached target is encouraging; variability at 1,000 candidates still needs optimization. Pools of 100 or fewer use one request, so concurrency cannot improve them. Do not infer a universal speedup from these measurements. Timings include actual authentication, HTTP, database access and result ranking, but exclude upload, document extraction, user-interface acknowledgment and deep AI. The existing paid production intake was not benchmarked end to end or replaced by this milestone.

## Cost comparison and remaining gates

Measured locally: the initial screening route uses 0 provider calls; the unchanged route rerun uses cached scores. Existing priority generation still costs its one job-level model request, with extra rule output when enabled. Actual extra tokens have not been measured against a live provider. No production invoice savings have been established.

500 full assessments versus 20 selected full assessments would be 96% fewer initial assessment requests, before retries and exceptions. That is a projected funnel comparison, not a measured deployed saving. The complete bulk ingestion/UI, durable progress, parsing reuse/deduplication, recruiter overrides, final Top 10, batch-specific AI caps, and real end-to-end quality/cost/latency gates remain unfinished. Existing `ai_model_rates` had no rows in the inspected staging metadata; missing pricing must never be reported as free model use.
