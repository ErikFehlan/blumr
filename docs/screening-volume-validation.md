# Higher-volume screening validation — October 19, 2026

This extends the evidence repair to 500, 1,000, 5,000 and 10,000 candidates per
occupation. The screening engine is unchanged from `bf87846`; test infrastructure
and coverage are in `62bcddb`. PR #120 remains draft and production is unchanged.

## Evidence quality and reliability

The new evidence fixture contains **1,008 checks**: 28 work capabilities, 12
assertion contexts and three layouts across seven occupations. All pass on the
existing engine: **420 supported claims recognized**, **588 unestablished claims
withheld**, and **zero source quotation failures**. Cases cover present/past work,
projects, mixed actors, team statements, future and conditional work, negation,
limited assistance, bullets and CRLF documents. Labels were authored before the
first execution; no engine changes or expectation weakening were needed.

These are correlated, assistant-authored generated diagnostics. They are not
1,008 independent recruiter labels and do not establish production accuracy.
Existing typed-qualification and private-source checks remain separate. The
committed aggregate report is `screening-volume-accuracy.json`; the executable
fixture retains every input and expected result.

The complete local Node suite passes **488/488 tests**. The additional large-pool
coordinator tests use 10,000 IDs and check exactly 100 page requests, at most three
requests in flight, no missing/duplicate candidates, truthful provisional status,
out-of-order completion and retained near misses. Injected late transport failure,
rubric changes, missing/duplicate page rows and cancellation stop safely and settle
in-flight work before returning. These use a simulated transport, not 100 live
HTTP requests. The first empty progress notification occurs before requests begin;
this does not measure browser rendering time.

## Local performance workload

Seven occupations each use their five canonical priorities. Every size includes
exactly 20 fully documented candidates and 20 transferable near misses among
keyword-only, unrelated and contradicted profiles. Unique neutral record text and
varying document length prevent exact-text cache reuse. This is still **five
semantic archetypes per occupation**, not 10,000 independently varied resumes.

Each size is measured three times for parse/score/rank and already-parsed
score/rank. Five samples measure reranking existing in-memory result objects.
Every returned quote is checked against its source, all candidate records must
remain accessible, and the expected Top 20 and near-miss 20 must be recovered.

Timings exclude HTTP, database queries, upload, PDF/DOCX extraction, UI and AI.
Existing-result reranking is **not** a durable database-cache read. Sampled process
RSS includes parsed inputs, scored results and allocator retention; it is not an
isolated per-candidate allocation or continuous peak-memory measurement. The host
is not a dedicated benchmark machine. All provider-free screening calls cost $0
in model fees; this excludes infrastructure and development-assistant costs.

## Measured local results

All **28 occupation/size combinations** recovered the expected Top 20 and all 20
near misses, retained every candidate, and passed every quote-provenance check.
No provider calls were made. Values below are ranges of the three-sample medians
across occupations; these are not p95 or production service-level measurements.

| Candidates | Parse + score + rank | Already-parsed score + rank | Rerank existing results in memory |
| ---: | ---: | ---: | ---: |
| 500 | 0.43–0.88 s | 0.22–0.60 s | 0.09–0.14 ms |
| 1,000 | 0.76–1.46 s | 0.44–1.10 s | 0.17–0.27 ms |
| 5,000 | 3.56–8.78 s | 2.45–6.23 s | 1.43–3.30 ms |
| 10,000 | 7.60–19.09 s | 5.02–13.03 s | 3.29–13.74 ms |

At 10,000 candidates the slowest tested occupation was clinical (19.09 s cold).
The observed process RSS reached 1580.02 MiB at a sampling point.
Synthetic input sizes ranged from 733 to 3,165 bytes; see the JSON for exact per-pool
sizes and all raw timing samples. This is a scale test of unchanged engine code,
not a before/after speed optimization. Input distributions differ from the earlier
1,000-resume benchmark, so those figures must not be presented as speed gains.

Full data, runtime details and source hashes:
[screening-volume-performance.json](screening-volume-performance.json).

## Bounded-page memory diagnostic

The all-parsed benchmark's 1,580 MiB observed RSS prompted a separate fresh-process
check. The existing coordinator processed **10,000 clinical candidates in 100
pages**, retaining scored results but discarding each page's parsed inputs. With a
256 MiB V8 old-space cap, observed RSS was **243.77 MiB** and heap use **127.54 MiB**.
The expected Top 20, near-miss 20 and every source quote passed. Total elapsed time
was **18.66 s**, including full-pool quote verification; first results appeared in
**485 ms** through the simulated transport. These are not hosted/UI timings and
this is not a measured Supabase memory limit. No engine change was needed: the
finding supports preserving bounded parsing instead of retaining every parsed
resume. Real workload memory and document sizes still require capacity monitoring.

[Exact diagnostic method](screening-volume-memory-method.md) and
[measured memory data](screening-volume-memory.json) are retained for reproduction.

## Hosted test recovery

The previous hosted attempt on `bf87846` passed Node/Deno/PostgreSQL, browser and
criteria checks, but failed during fixture upload and then cleanup. Storage logs
identified SQLSTATE `08P01`, `max_client_conn` exhaustion; 374 synthetic files were
left in the explicitly identified test workspace. This was not a demonstrated
candidate quota failure. Ordinary Postgres backend counts do not show the pooler's
client limit, so a low subsequent database connection count does not disprove it.

The revised test harness consumes error responses, uploads one file at a time
with a 500 ms gap, and retries only explicit transient connection pressure or a
server Retry-After instruction within a bounded budget. Quota/auth failures,
duplicate writes and ambiguous network-write failures are not retried. Cleanup
deletes owned fixture objects in chunks of 100. A one-time recovery script checks
the exact failed run, synthetic identity, workspace, membership, path shape and
object ownership before reconstructing its private cleanup manifest. Other test
runs and user data are outside that recovery. No database limits, RLS rules,
storage quotas or production settings were changed.

The hosted workload stays within the existing 1,000-candidate workspace quota.
5,000/10,000 tests are local kernel/coordinator workloads, not claims that a single
hosted workspace currently permits those imports. Hosted uploads use synthetic
TXT files with known extracted text and do not validate PDF/DOCX ingestion.

## Hosted result — passed

Workflow [39309016535](https://github.com/ErikFehlan/blumr/actions/runs/39309016535)
passed on executable/test commit `62bcddb`. The Node/Deno/PostgreSQL validation,
separate browser/application workflow and criteria backend checks also passed.
The report-only follow-up commit changes no executable code.

| Candidates | Cold ranking | Cached ranking, two runs | First cached page |
| ---: | ---: | ---: | ---: |
| 20 | 1.40 s | 0.67–0.86 s | 0.67–0.86 s |
| 100 | 2.20 s | 0.86–1.00 s | 0.86–1.00 s |
| 500 | 5.47 s | 2.45–2.94 s | 0.89–0.89 s |
| 1,000 | 10.25 s | 5.18–5.33 s | 0.94–1.07 s |

Every cold call missed the durable result cache; every warm call hit all requested
candidate results. Workspace isolation, forged-input protection, provisional page
status and changed-document cache invalidation passed. All seven five-candidate
occupation pools passed their 28 expected pair orderings, near-miss retention,
source quotations and cache checks. The fixture workspace recorded **zero provider
calls**, intake tasks and reassessment tasks. No AI assessment was purchased.

All 1,000 fixture uploads completed with no retry messages. Fixture creation and
paced upload took **694.28 s (11.57 minutes)**, excluding subsequent ranking. This
is a recovery-oriented setup run, **not evidence of fast bulk import**. Pacing
avoided the observed failure in this run; it does not prove the managed Storage
pooler root cause is fixed. Cached ranking at 1,000 is still above a consistent
low-single-digit-second target. These timings have one cold and two warm samples,
so they do not establish tail latency or production capacity.

Both cleanup steps passed; the 374 objects from the prior failed run were also
removed under explicit ownership guards. The experimental route was disabled
afterward. Production remains unchanged. Full measurements:
[screening-volume-staging.json](screening-volume-staging.json).

## Reproduction and release limits

```sh
node --test tests/*.test.js
node scripts/evaluate-screening-volume.mjs test-results/screening/volume-accuracy.json
node --expose-gc scripts/benchmark-screening-volume.mjs test-results/screening/volume-performance.json
```

The full CPU benchmark is intentionally separate from per-PR fast regression
gates. Engine and fixture hashes bind the results to their inputs. The aggregate
accuracy JSON omits successful per-case rows; the runner reproduces them all.

Independently recruiter-labeled, de-identified real pools remain necessary for
call-worthy precision at 20, qualified-candidate recall and near-miss recovery.
Actual PDF/DOCX/ZIP ingestion, large interrupted uploads, live Top 5 generation,
the full Top 20 → AI Top 10 UI and end-to-end batch cost controls remain release
gates. This load exercise does not mark those components complete.
