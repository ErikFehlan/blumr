# Rules-first screening: foundation milestone

Status: development module, locally verified; not integrated, staged, or deployed. Related: #118, #119. Neither issue is complete.

## Existing architecture inspected

- Frontend: static JavaScript/HTML application, not a framework rewrite candidate. Existing job wizard, hiring-priority UI, evidence viewer, candidate automation and Word/PDF preview patterns should be reused.
- Canonical priorities: `refine-job-criteria/priorities.mjs` validates at most five priorities against original job passages. Required/preferred/inferred status and recruiter review already exist. The unified-priorities migration preserves draft reuse. Do not generate a second priority list.
- Existing deterministic criteria generation: `refine-job-criteria/code-first.mjs`.
- Evidence interpretation: shared `transferability.mjs`, `experience-intelligence.mjs`, `capability-workflows.mjs`, source instruction filtering and exact resume-source quotation resolution.
- Backend: durable resume-intake and reassessment tasks, leases, model routing, direct-request idempotency, workspace authorization/RLS, provider usage and reservation counters already exist. Reuse these instead of starting a second unrelated queue/security model.
- Read-only staging inspection confirmed active assessment/criteria/reassessment functions and the expected tables with RLS enabled. This is metadata inspection, not an isolation/security test. Staging `ai_model_rates` currently has zero rows: rate coverage must be checked before reporting monetary cost; missing rates must never imply free AI.
- #118 and #119 remain open and describe the desired architecture, not deployed support.

## Implemented in this milestone

`supabase/functions/_shared/screening-engine.mjs` is provider-free and can run in Node or the existing Edge runtime. It accepts the existing canonical priorities plus explicit weighted rule configuration. It does not infer production-ready rules from arbitrary JD language.

- Stable SHA-256 rubric fingerprints cover engine version, workspace, job, job version, feedback version, priority content, weights, conditions and title aliases.
- Nested AND/OR conditions, boundary-aware terms and explicitly configured related capabilities. Rule size/depth and text/cache limits are bounded.
- Exact resume fragments, direct versus inferred matches, practice versus mention/exposure, unknowns, conservative negation and visible contradictions. Mixed positive/negative evidence is capped and stays reviewable.
- Titles are informational only and cannot boost a candidate into a shortlist.
- Weighted priority scores, provisional/final ranking, top 20, near-miss buffer and all remaining candidates. No rejection or employment decision.
- Bounded per-session content-addressed result reuse, with defensive copies to prevent cached evidence mutation.
- No provider imports, network calls or model requests in the kernel. All local benchmark paths use zero AI calls.

The caller must authorize workspace/job access before loading any resume or rubric. Namespace hashing is not authorization. No database or public endpoint is added in this milestone.

## Verification

Commands:

```sh
node --test tests/*.test.js
node scripts/benchmark-screening.mjs
```

312 JavaScript tests passed, including 12 new screening tests. Existing Deno, SQL, browser and live release checks have not been run for this milestone. The kernel is not yet part of an authenticated request path.

Raw results: `docs/screening-benchmark.json`, 12 runs per size on Node v24.19.0. Synthetic roughly 2.5 KB plain-text resumes, two priority rules, engineering vocabulary. These are development CPU/hash measurements, not real PDF/DOCX upload or production latency measurements; 12 samples do not establish a production p95.

| Candidates | Parse + score + rank p50 / p95 ms | Preparsed score + rank p50 / p95 ms | AI calls |
| --- | --- | --- | --- |
| 20 | 1.48 / 11.98 | 0.22 / 0.59 | 0 |
| 100 | 7.34 / 8.86 | 0.71 / 1.34 | 0 |
| 500 | 37.07 / 43.17 | 4.67 / 7.17 | 0 |
| 1,000 | 69.85 / 79.27 | 9.25 / 9.61 | 0 |
| 2,000 | 133.83 / 140.80 | 16.46 / 17.44 | 0 |

At 1,000 candidates, preparsing reduced median local parse/score/rank work from 69.85 ms to 9.25 ms (about 7.6x). This compares two paths in the new kernel, not the old production engine. Full cache lookup still hashes exact resume bytes and clones evidence; the benchmark shows it is slower than rescoring preparsed evidence for this small rubric. Do not assume every cache is a speed improvement. Durable version-addressed lookup should avoid fetching/hashing full resumes on unchanged reruns.

No existing-engine live baseline, recruiter-labeled precision/recall study, real multi-industry corpus or measured end-to-end AI savings has been completed. Accounting and healthcare unit examples test configurable vocabulary only; they do not establish domain ranking accuracy. Provider charge for this kernel is zero; parsing infrastructure, storage and downstream AI are separate costs.

A hypothetical 500-to-20 gate would request 96% fewer initial full assessments than one per applicant. That is arithmetic, not measured production savings, and retries, exceptions and changing rubrics affect actual totals.

## Implementation sequence and release gates

1. **Foundation (this PR):** review kernel and explicit rule contract. Keep inactive until integration and quality gates pass.
2. **Canonical job intelligence integration:** add validated structured conditions to the existing cached priority-generation response; retain exact provenance, requirement types, alternatives, explicit weighting provenance and recruiter overrides. Preserve generation once per meaningful job/feedback version. Do not tokenize prose into unsupported capabilities or silently invent weights. Unsupported/ambiguous rules must require review rather than narrow eligibility.
3. **Shared authorized screening path:** persist rubric/parsed evidence/scores with version keys, workspace RLS and cache invalidation; integrate individual intake and refresh. Add transaction/authorization/concurrency tests before backend use. Reuse experience intelligence for depth/chronology and curated transferable workflows; current kernel does not verify years or seniority.
4. **Bulk intake:** extend existing document extraction, signature/ZIP guards, private storage and durable leases. Add bounded extraction concurrency, batch manifests, exact/normalized deduplication, resumability, per-file errors and truthful progressive ranking. Suppress automatic full AI assessment for ordinary imported applicants. Handle scanned/low-confidence resumes as explicit review work.
5. **Recruiter workflow:** reuse job and evidence UI conventions; top 20/near misses/all applicants, promote/demote overrides, provisional labels and genuine progress. Keep initial top 20 visible while deep analysis progresses. Add browser tests and timing of acknowledgment/first/final results.
6. **Selective deep AI:** reuse existing assessment engine for approved finalists. Add atomic per-batch reservations/caps, cross-worker duplicate-call protection keyed by resume/rubric/feedback/model/prompt, provider token/cost reconciliation, missing-rate warnings, progressive results and persistent top 10/phone-screen questions. Never treat the kernel's zero AI call count as total batch usage.
7. **Production readiness:** compare to current engine on recruiter-labeled pools across occupations. Measure precision/recall, near-miss rescue, false negatives and unsupported evidence. Benchmark real 20/100/500/1,000+ document batches, actual token/call/cost totals, interrupted tasks, authorization and tenant isolation. Complete existing staging/release gates, then request production deployment authorization.

## Known kernel limits

Sentence-level matching can conflate clauses or miss paraphrases; negation is deliberately conservative and can overflag unrelated negatives. Work-history dates, recency, verified credentials, direct ownership and seniority thresholds are not resolved by this module. Configured term matches are evidence signals, not a claim of full qualification. Personal-data filtering is defense in depth, not a complete protected-trait/proxy classifier. Approved rule generation and security review must constrain what enters the rubric. Low-confidence parsing and unusual document layouts require separate recovery paths.
