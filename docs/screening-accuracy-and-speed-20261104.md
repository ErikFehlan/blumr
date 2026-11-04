# Screening accuracy and speed — 2026-11-04

A role-specific gap in an older job could incorrectly cap a qualified candidate at 35. The new engine resolves that gap only when a separate, later, non-overlapping role contains sufficient personally asserted evidence. Both periods must have month-level dates; the denial itself must be role-scoped. Original evidence quotations remain unchanged and the historical gap references the evidence that superseded it.

For example, “Did not use Terraform in this role” under January 2018–December 2020 followed by “Implemented Terraform modules” under January 2021–Present now supports the hands-on Terraform requirement. Blanket, current, undated, overlapping, future, team-only and unrelated-clause cases remain flagged. This change covers skill presence and depth; it does not infer years of tool experience or rewrite credential rules. The engine version changes from screening-v5 to screening-v6 so durable scores refresh.

## Processing changes

- Extract one document at a time; overlap at most two save operations. Remove the fixed 250 ms pause per file (25 seconds of intentional pacing per 100 files).
- Serialize duplicate candidate saves. On explicit throttling or connection pressure, pause subsequent work and reduce the batch to one save at a time. Failed writes remain visible for explicit retry; they are not automatically replayed.
- Reuse compiled job intelligence and parsed evidence inside a warm worker. Every request still reads and authorizes current database sources. Workspace, source changes, approvals/revocations, document text, engine version and scoring date participate in cache identity.
- Bound cache entries, estimated retained input, interpretation memos and reuse lifetime. Defaults: 32 jobs, 100 resumes, five-minute reuse, 16 MiB estimated evidence budget plus a separate 4 MiB job budget. These estimates are not measured heap limits. Entries are removed on access/insert after expiry or worker teardown; this is not a persistent cache.

## Validation

- 576 JavaScript tests passed, including 19 historical-evidence cases, six runtime/cache tests and nine upload-pool tests.
- Both backend entry points passed Deno type checks; 16 targeted backend tests passed.
- Local Chromium 133: mixed PDF/DOCX/ZIP upload journey, duplicate handling, explicit retry/start, reload, job switching and draft persistence passed. The test asserts two concurrent saves and one successful write per candidate. Existing resume-intake and isolated Word-parser browser journeys also passed. Database/provider transport is simulated in these local browser tests; no paid AI calls were made.
- Repository CI uses its pinned Playwright/Chromium environment and separately exercises PostgreSQL permissions and transactions. See PR #159 for current CI status.

## Measured local CPU performance

Run `node scripts/benchmark-screening-runtime.mjs`. Five alternating samples compare the updated engine with and without runtime caching. Every result is checked for exact equality. Raw samples are in [screening-runtime-performance-20261104.json](screening-runtime-performance-20261104.json).

| Synthetic workload | Uncached median | Cached median | Speedup |
| --- | ---: | ---: | ---: |
| 500 unique resumes across five pages | 279.54 ms | 257.01 ms | 1.09× |
| 20 resumes rescored across ten pages | 171.57 ms | 58.48 ms | 2.93× |

These measurements exclude file extraction, database, network, UI and AI latency. A cold worker receives no benefit from previously cached resumes. The modest new-resume gain may vary; the repeated-work case is the main CPU improvement. No production latency or real-world accuracy percentage is claimed.

## Release boundary

Changes are on the PR branch only. No migration, deployment, provider setting, billing setting or subscription change is included. Deploy both affected functions and frontend assets through the normal release process after review. Production validation should measure actual import and screening latency separately from AI completion time.
