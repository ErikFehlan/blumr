# Bulk screening workflow — October 20, 2026

Development branch `feat/rules-first-screening`, draft PR #120; issues #118 and #119 remain open. Production has not been changed. This report supersedes the earlier reports' statements that bulk imports, finalist selection and batch budgets have not been implemented. Earlier engine accuracy and benchmark reports remain historical evidence.

## Implemented workflow

The existing Candidates page now offers bulk rules screening when the rollout flag is enabled. Authorized PDF, DOCX, DOC and TXT uploads, including ZIP archives, use the existing local extraction and private resume viewer. No LinkedIn scraping or account automation is involved.

- A durable manifest accepts up to 1,000 files, 10 MB per resume, 1 GB expanded per batch and 200 MB per ZIP. Existing workspace candidate and storage quotas still apply. ZIP entries are inspected before extraction, inflated one at a time and checked against actual size and CRC. Traversal, encryption, unsupported entries and inconsistent metadata fail explicitly.
- Each file is parsed locally, deduplicated within its position by normalized content and saved through existing private Storage/document validation. Uploads are serial and paced to respect the staging Storage connection limits. This is intentionally separate from parallel background assessment. Saved files survive navigation/reload; unfinished files require reselecting originals. The interface states that the tab must stay open until files are saved.
- One job-specific rubric reuses canonical Top 5 priorities, qualification rules and approved manager context. Cached scoring is provider-free. Failed files keep the batch provisional until retried or explicitly excluded. A sealed batch is final only when every retained candidate is scored against the current source.
- The initial Top 20, near-miss 20 and searchable remaining candidates stay accessible. Exact source passages accompany the leading candidates. Recruiters can add/remove/reorder up to 20 finalists. No automatic rejection, stage change or approved fit-score write occurs during screening.
- Explicit finalist selection queues only selected candidates through the existing durable assessment worker, shared concurrency limits, provider leases and evidence validation. Deep results appear progressively; the separate Top 10 is provisional until all selected assessments are ready. Existing approved scores change only after explicit approval.
- Unselected bulk candidates never enter the legacy full-AI intake queue, including after reload or source edits. Changed sources invalidate rankings and revoke stale AI consent. Restoring old text does not silently restart paid work. Unchanged completed assessments can be reused.
- Atomic per-batch reservations precede provider admission. At most 40 reserved calls per batch and two per candidate/revision cover initial attempts and validation repair. Missing/stale model rates fail closed. Token usage, cache reads/writes, model identity, configured prices, recorded cost and unsettled reservations are attributed to the batch. Conservative reservations are retained for ambiguous outcomes. Recorded USD is a token-based estimate, not an invoice reconciliation.
- RLS, scoped foreign keys, authenticated source reads, private worker writes, account export and deletion cascades include the new records. No candidate text is stored in the cost ledger. The normal deployment sequence installs the schema before updated handlers and checks changed routine sources and permissions explicitly.

## Verification and limitations

Local verification on the final development work includes 498 passing Node tests, focused Deno backend tests, the bulk SQL suite on PostgreSQL 17 through PGlite, the existing individual-intake browser journey and the new bulk browser journey. GitHub Actions separately runs real PostgreSQL 17, backend type checks and the broader recruiter browser suite; exact final workflow results are recorded below when finished.

The new browser journey runs the actual application, PDF/DOCX parsing, ZIP handling and shared deterministic engine. Database/provider transport is simulated. Its 25-file batch includes one duplicate, a damaged PDF and a recoverable interrupted upload. It verifies 23 unique saved candidates, no initial AI, 20 simulated finalist calls, replay without extra calls, reload with actual rules-only candidate records, explicit approval, zero legacy intake requests, original-resume viewing, mobile width, and preservation of open evidence and the next-batch budget across refresh, job switches during a delayed manifest request, and exclusion of concurrent import starts. These browser observations do not establish hosted provider latency or cost.

A browser resource regression failed before the PDF-reader fix: a parsing worker remained live after extraction. The reader now destroys its loading task in a `finally` block, including parse failures and page-limit errors. A subsequent **1,000-document parser run (500 PDF, 500 DOCX) completed in 40.13 seconds**, preserved the expected source passages, peaked at **one PDF worker**, and ended with **zero workers**. These are repeated synthetic fixtures using the actual application parser, not 1,000 independently varied resumes; upload, HTTP, scoring and AI are excluded. Raw observations: `bulk-screening-parser-volume.json`. Run it with `BULK_PARSE_COUNT=1000 node tests/bulk-screening-browser.cjs` in the browser-test environment.

The SQL suite covers authenticated inserts, isolation, private write permissions, incomplete sealing, changed-source writes, document/hash binding, consent invalidation, worker claim recovery, duplicate selection, provider reservation fencing, missing rates, budget limits and usage accounting. The live staging metadata for all 22 bulk-related routines matched the committed source expectations and caller permissions before release packaging.

Two staging failures were retained and fixed before the larger rerun:

1. An expression-index hash function lacked authenticated execute permission. Staging upload failed immediately. The pure hash function now has the required grant; an authenticated document insert is in the SQL regression suite.
2. Per-file wakeups allowed many workers to score/write the same batch. Database logs showed cache-row lock waits and statement timeouts. Upload notifications now coalesce over 15 seconds; batch claims use atomic `FOR UPDATE SKIP LOCKED` with a two-minute recovery window; ordered, serialized cache writes skip unchanged rows. No database limits, candidate quotas or RLS protections were relaxed.
3. A subsequent run completed all 500 rules scores but hit a transient database timeout while reading progress during deep analysis. The failed run is retained in `bulk-screening-staging-interrupted.json`. The snapshot now uses a latest-document index and returns full evidence only for the leading 40 and selected finalists; all other candidates retain bound score summaries, and unprocessed candidates remain unscored. SQL tests verify 60 retained candidates with 55 scores, exactly 40 full evidence records and five unprocessed records. Finished batches use status reads during AI progress instead of redundant cache refreshes. The staging harness has bounded recovery for idempotent read/refresh failures only, records retry counts and still fails on authorization/validation errors. Final hosted verification of this optimization is pending.

The existing evidence suite still reports 1,008 synthetic checks and seven occupation pools, with the interpretation repairs described in `screening-evidence-validation.md`. Those are correlated diagnostic fixtures. Three private documents were previously checked on selected qualifications; that is also not a representative recruiting study. No production accuracy percentage, precision@20 or qualified-candidate recall is claimed.

## Hosted 500-resume validation

The staging harness imports 500 unique synthetic TXT resumes plus one duplicate through authenticated batch RPCs, actual Storage and document inserts. It checks incremental provisional results, final and cached ranking, workspace isolation, zero paid tasks before consent, real selective AI, exact source quotations, batch usage, replay and explicit approval. A $10 conservative reservation cap bounds its selected Top 20. Disposable fixture accounts/files are removed and both rollout flags are disabled afterward. PDF/DOCX/ZIP parsing is covered by the browser test, not by these hosted TXT timings.

The first complete run passed on `aa7ffc829bf2cd117d68b58dbb55eba069f98324`: [workflow 39423460136](https://github.com/ErikFehlan/blumr/actions/runs/39423460136), raw results in `bulk-screening-staging-first.json`.

| Measurement | Observed |
| --- | ---: |
| Authenticated batch creation | 198 ms |
| 500 unique TXT uploads, sequential and paced | 375.99 s (6.27 min) |
| Incremental 20 / 100 / 500-file ranking calls | 2.87 / 2.71 / 4.97 s |
| Remaining ranking after sealing | 3.03 s |
| Cached 500-candidate ranking, three observations | 2.37 / 3.35 / 2.62 s |
| Initial screening provider calls | 0 |
| Deep analysis of 20 selected candidates | 406.81 s (6.78 min) |
| Real provider requests / extra replay requests | 20 / 0 |
| Provider input / output tokens | 86,461 / 25,066 |
| Recorded token-based cost estimate | $0.6527488 |
| Conservative reserved amount / test cap | $4.89873 / $10 |
| Unsettled usage records | 0 |

The 500-file incremental response had 458 candidates ranked and correctly remained provisional; after sealing, all 500 were ranked. Every Top 20 candidate came from the supported synthetic archetype. The initial rules Top 20 stayed available beside the final Top 10. All selected AI quotations were literal source passages; explicit score approval, selection replay, source invalidation and foreign-workspace denial passed. All disposable fixtures were removed and the experimental route was disabled.

This meets sub-second batch acknowledgment and low-single-digit cached ranking in these observations, not a production percentile promise. New imports and deep AI remain minutes-long operations with progressive results. Serial upload pacing respects the observed Storage limits; the real provider runs under the existing shared worker capacity. No full-pipeline instantaneous-speed claim is supported.

The old one-assessment-per-applicant path would request 500 initial assessments for this batch; this run requested 20, a **96% reduction in initial call count**. The 500-call baseline is arithmetic, not a separately purchased benchmark. There is no measured production invoice saving. Final CI and the complete isolated staging release suite are running against the final packaged commit.

## Release gates

1. Pass the hosted 500-resume workflow and final CI, then inspect its timings, model-call count, recorded costs and cleanup evidence. Larger real-document upload mixtures remain a separate capacity exercise; the previous 1,000-candidate cached-ranking measurements do not validate this new import workflow.
2. Evaluate untouched, independently recruiter-labeled, de-identified pools across occupations. Measure call-worthy precision at 20, qualified-candidate recovery, near-miss rescue and unsupported interpretations. Include live Top 5 generation and varied scanned/multicolumn documents. Source quotations alone cannot establish correct interpretation.
3. Confirm the deployed model's current rate and the intended workspace budgets. Default-off rollout uses `screening_feature_config.enabled`; structured priority hints use `RULES_FIRST_SCREENING`. No bulk assessment starts merely because a resume is uploaded.
4. Run the existing full isolated staging/release checks. Production merge/deployment and enabling the feature require authorization. Keep the draft PR and backlog open until the relevant quality/release gates are met.

## Reproduction

```sh
node --test tests/*.test.js
deno test --allow-env tests/rules-screening-routing.test.ts tests/bulk-screening-backend.test.ts tests/job-reassessment-worker.test.ts tests/security-backend.test.ts tests/priority-drafts.test.ts tests/hiring-priorities-worker.test.ts
psql -v ON_ERROR_STOP=1 -f tests/bulk-screening.sql
node tests/bulk-screening-browser.cjs
```

The browser test needs the repository CI's Playwright runtime plus `mammoth` and `pdfjs-dist`; `TEST_CHROME` optionally selects an installed Chromium. The hosted harness runs only through the existing staging project with disposable synthetic fixtures and explicit cleanup. It never targets production.
