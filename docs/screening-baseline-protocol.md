# Screening baseline protocol v1

Issue [#125](https://github.com/ErikFehlan/blumr/issues/125), part of Copilot epic #123. Protocol date: October 26, 2026. Application baseline: `168e0195604845f923ffc946b6c3bae3d5960c73`. Budget governance is separately prepared in PR #132; neither this protocol nor its tests deploy that change.

## What this change establishes

The actual authenticated individual-rules and bulk routes now have direct parity tests, using separate simulated stores so one route cannot satisfy the comparison with the other's cached answer. Seven existing occupation pools supply 35 synthetic profiles. The comparison checks the full score, mandatory-qualification status, findings, source quotations, review requirement, and verification questions. It covers cold computation, warm cache, saved review, changed resumes, requirements, priority order, approved/revoked/stale feedback, a new date, and blocked stale priorities. A 105-profile case checks the 100-row page boundary and retains Top 20, near misses and remaining candidates.

These are regression fixtures authored for development, **not an independent accuracy sample**. Network/RPC responses are simulated; these tests cannot certify installed production database definitions or authorization. Existing security and native PostgreSQL checks remain required. No application source, score calculation, database schema or UI changes are made by this work.

The SQL bulk suite separately verifies that ordinary intake and selected-finalist intake supply identical complete input records for the same eligible source, and that the durable worker claim preserves that input. An unselected bulk candidate remains ineligible for paid processing. Existing resume-intake tests validate priority/context handling and reject invented evidence. This establishes the input/output contracts; it does not require deterministic 0–100 screening scores to equal deep-AI 0–10 scores or claim live-model consistency.

## Evidence register

| Measurement | Current evidence | Still needed |
| --- | --- | --- |
| Cross-path qualification evidence | Route regressions plus SQL deep-input assertions | Confirm deployed definitions through existing isolated staging/release gates |
| Local throughput | [Qualification CPU baseline](screening-parity-cpu-baseline.json), seven occupations × 20/100/500/1,000 profiles × 12 samples | Mixed document extraction, network, database, concurrent users and provider timings |
| Recruiting accuracy | Preserve the already-confirmed October 20 recruiter acceptance; existing synthetic regressions remain separate | A frozen, authorized holdout with reviewer labels and uncertainty estimates before making numerical accuracy claims |
| Preparation and shortlist time | Measurement definitions below | Observed paired recruiter sessions; no fabricated starting values |
| Deep evaluation cost | Existing reservations, usage and historical staging reports | Current model/rate coverage, failed and unsettled attempts, durable retention and invoice reconciliation; coordinate PR #117 |
| $49 Pro contribution margin | Explicit calculation and input contract below | Actual usage distribution, provider cost coverage and operating-cost allocations |

PR #117 remains open and has conflicts with current main. Reconcile its durable ledger/rate/operation changes separately against current accounting rather than importing its older backend wholesale or building a second ledger. Historical token estimates do not substitute for current invoice evidence.

## Reproduce the local baseline

```sh
node --test tests/*.test.js
deno test --allow-env tests/screening-parity.test.ts tests/rules-screening-routing.test.ts tests/bulk-screening-backend.test.ts tests/resume-intake-backend.test.ts
# Run only against a fresh disposable local test database:
psql -v ON_ERROR_STOP=1 -d blumr_disposable_test -f tests/bulk-screening.sql
# Run after other CPU-heavy local validation has finished:
mkdir -p test-results
node scripts/benchmark-screening-qualifications.mjs > test-results/screening-qualification-baseline.json
```

The benchmark records its protocol version, parent commit, worktree state, source and workload SHA-256 hashes, runtime, CPU, fixed evidence date, all raw samples and nearest-rank p50/p95. The committed report was measured with tracked test/benchmark changes before their commit; exact source hashes identify the executable versions. Its 12-sample p95 is the maximum observed sample, not a production tail-latency estimate. Parsing means interpretation of already-extracted text. Parsed-evidence reuse is in-memory reuse, not a durable database-cache hit. Five repeated semantic profiles per occupation test workload size, not applicant diversity. The shared host is not a controlled performance laboratory.

Do not call a change faster unless the before/after measurements use the same machine class, workload hashes, warmup policy, fixed date, sample count and runtime, and account for host load. Keep first-use samples in the raw report; do not silently discard slow observations. Rules have zero model calls; infrastructure and development-assistant costs are outside this number.

At 1,000 profiles, the October 26 local run measured the following milliseconds. Each row has 12 observations per path on Node v24.22.1 / AMD EPYC 9V74. No scoring optimization was introduced, so these are reference observations, not improvements.

| Synthetic role pool | Parse/score/rank p50 | Sample p95 | Already-parsed p50 |
| --- | ---: | ---: | ---: |
| Cloud | 860.55 | 978.08 | 553.55 |
| Accounting | 759.95 | 893.25 | 461.44 |
| Clinical | 1,477.80 | 1,638.73 | 700.46 |
| Warehouse | 877.55 | 923.13 | 561.50 |
| Education | 688.39 | 776.02 | 385.26 |
| Maintenance | 1,373.72 | 1,512.65 | 585.90 |
| QA | 985.80 | 1,138.88 | 663.32 |

## Next isolated workload run

Prepare one run manifest before execution: protocol/run ID, application and migration commits, environment, fixture hashes/semantic diversity, file-type/size distribution, OCR cases, engine versions, UTC time, browser/runtime, model identifier and dated rate snapshot, cache state, concurrent-user count, intended repetitions, timeout policy, approved total provider cap and cleanup ownership manifest. Keep candidate text and identifiers in the authorized fixture environment; retain aggregate measurements in the repository.

Use 20/100/500/1,000-document pools and separate 1/5/10-user trials, respecting existing workspace limits. Each user has an isolated job/workspace. Do not infer a production capacity claim from the local synchronous CPU runner. Repeat each selected configuration at least 20 times for an initial distribution, report every sample, and disclose that p95 remains imprecise. Larger paid repetitions require their own reviewed cost bound; a budget is not inferred from this document. Begin with zero-provider screening and simulated deep processing. Use existing staging harnesses and cleanup guards; do not create another queue or bypass permissions to obtain load.

Record monotonic timestamps for: file selection, UI acknowledgment, first useful provisional shortlist, final rules Top 20, explicit finalist selection, first deep result, final deep Top 10, and recruiter approval. Report durations from their named start event, not interchangeable notions of “response time.” Track parser failures, excluded files, unreadable documents, retries, incomplete imports, duplicate suppression and all candidates retained. Timeout/failure counts remain in the denominator; show completed-request timings alongside their completion rate.

Replay the same saved selection, reopen/copy outputs, reload during import, interrupt a worker, change one resume and one approved priority, and test a lost acknowledgment. Record provider requests and charged/reserved usage before and after each action. Reopening/review/copy must add no requests; source changes must invalidate the appropriate artifacts. Deep work requires fresh explicit selection where current consent is stale. Do not generate fresh paid assessments merely to recreate a hypothetical historical baseline.

## Human quality and time measurements

Extend [the existing recruiter holdout protocol](screening-recruiter-holdout.md); do not repeat previously granted acceptance as an approval prerequisite. Freeze the job, priorities, authorized source versions, label guide and inclusion criteria before engine execution. Two reviewers label independently, blinded to scores and rank. Preserve both labels, uncertain cases, disagreement and the adjudication reason. A case used to tune the engine leaves the holdout.

Report per role: precision@20 with the actual returned-list denominator (up to 20), yes/uncertain/no counts, recall@20 among all adjudicated yes cases, recall including near misses, unsupported-interpretation count, and document coverage. Do not count uncertain cases as proven negatives. Include sensitivity bounds treating unresolved cases as qualified versus unqualified. For simple proportions, record numerator/denominator and a 95% Wilson interval; for aggregated or before/after results, bootstrap by job/application pool, preserving paired cases and reporting the number of independent pools. Correlated synthetic variants must never inflate the independent sample size. With too few independent pools, present descriptive results and say the interval is not reliable.

Measure recruiter time in paired sessions with the same source context and comparable tasks; counterbalance task order to reduce practice effects. Log active preparation time, elapsed time to the first recruiter-judged qualified shortlist, interruptions, help needed and incomplete tasks. Report participants, roles, candidate counts and per-session values. Calculate the paired percentage change as `(baseline_seconds - copilot_seconds) / baseline_seconds`, requiring a positive baseline. Keep the 30% preparation and approximately 50% shortlist reductions as targets until observed; do not substitute CPU speed for recruiter time.

## Cost and contribution-margin contract

Use the existing ledger. For each workspace, feature and period record completed evaluations, provider attempts (including failed/repair attempts), input/output/cached/cache-write tokens, exact model and rate version, known estimated charges, unsettled reservations, missing usage/rates, and provider-invoice adjustments. Cache-write pricing must follow the provider/model's verified billing rule; do not universally assume a multiplier. Publish coverage as priced attempts / all provider attempts. A period with unpriced or unsettled work is incomplete, not zero cost. Exclude synthetic runs from customer usage while reporting their cost separately.

For each light/typical/heavy **observed** usage scenario, use:

`monthly variable cost = AI calls and retries + document/OCR charges + storage and egress + allocated variable hosting + payment fees + allocated support`

`contribution dollars = recognized monthly subscription revenue - monthly variable cost`

`contribution margin = contribution dollars / recognized monthly subscription revenue`

Use $49 as the initial undiscounted Pro price, disclose refunds/discounts and allocation assumptions, and keep fixed engineering/overhead separate. If a value is unknown, leave it unmeasured rather than treating it as zero. Report break-even evaluations only when marginal evaluation cost and non-AI costs are available. The approximately 40% deep-evaluation saving requires matched completed tasks, model/rate disclosure and retry coverage. A reduction in request count alone is not that measurement.

## Remaining exit criteria for #125

This change completes the local contract-verification slice and supplies a reproducible CPU baseline. Keep #125 open for isolated mixed-file/concurrent workloads, human timing/holdout evidence, cost-ledger reconciliation, and measured margin scenarios. No production deployment, production mutation or paid provider run is authorized by this protocol. Phase 1 can use these shared contracts while those measurements continue, but measured improvement claims wait for their actual evidence.
