# Screening accuracy challenge — October 19, 2026

**Release decision: not ready for production ranking.** The frozen engine failed 26 of 70 new challenge checks. A separate private source audit on three existing resume documents failed 6 of 18 qualification checks. These are diagnostic results, not an estimate of hiring accuracy.

## Method

- Engine baseline: `ba545ef46b14a879a5207a4c453e4460156982c9`; no engine code changed during evaluation. SHA-256 hashes of the engine files and new fixture are retained in the JSON report.
- The 70 challenge labels were authored before execution. They are assistant-authored adversarial expectations, not independent recruiter labels or a random sample. Several related checks test the same failure mode; their outcomes are not statistically independent.
- Requirements were supplied as canonical source-grounded priorities. This evaluates deterministic requirement compilation and matching, not live model-generated Top 5 quality.
- Private evaluation: 18 resume-only qualification checks across three current user-provided documents. Expected evidence was reviewed from the source before scoring. Text came from Library extraction, not blumr's PDF/DOCX import. No candidate names, resume contents, private file IDs, or quotations are included in this repository.
- All checks used the fixed assessment date 2026-10-19. No provider calls or application database writes were made. No production or staging deployment was required.
- `supported` means the source describes the requested work/qualification. `not_supported` includes partial or unknown evidence. A missed-supported check does not mean the candidate was rejected. No hire/reject labels were assigned.

## New challenge results

| Category | Checks | Passed | Failed |
| --- | ---: | ---: | ---: |
| wording | 12 | 5 | 7 |
| negation attribution | 10 | 7 | 3 |
| experience | 10 | 8 | 2 |
| credentials | 10 | 6 | 4 |
| capabilities scope | 10 | 8 | 2 |
| rubric | 6 | 5 | 1 |
| ranking | 6 | 1 | 5 |
| invariance | 6 | 4 | 2 |
| **Total** | **70** | **44** | **26** |

The 52 qualification checks included 29 clearly supported statements and 23 statements that did not establish the qualification. The engine recognized 15 of the 29 supported statements and missed/undercredited 14. It correctly withheld full credit in 19 of the 23 unsupported cases and incorrectly awarded full support in 4. There were no evaluation exceptions.

Only 1 of 6 expected ranking comparisons passed. Three tied and two were reversed. Four of six invariance checks passed: name changes, a separate gender line, source instructions and duplicate text did not change relevance. Line wrapping and patient-population wording did change scores.

Every returned quotation was found in its source. That does **not** mean every interpretation was correct: the engine sometimes attributed a manager's or team's quoted work to the applicant.

## Private real-document source audit

| Expected source evidence | Checks | Correct | Incorrect |
| --- | ---: | ---: | ---: |
| Qualification explicitly described | 11 | 5 | 6 |
| Qualification not established | 7 | 7 | 0 |
| **Total** | **18** | **12** | **6** |

The six misses were current CI/CD ownership, Azure network design, implementation of Azure controls, dated software-engineering experience with titles on separate lines, current vulnerability remediation and current SBOM generation. Five were only partially credited; one was marked unknown. These examples corroborate the wording/layout defects; they do not establish a candidate-pool precision/recall rate. No full candidate ranking was inferred from these isolated requirements.

## Required fixes, in priority order

1. **Correct attribution and constraint loss:** a manager's implementation, team ownership, or a supervisor's license must not establish the applicant's qualification. Preserve explicit license jurisdiction abbreviations.
2. **Correct negation scope:** “no downtime” is not “no Azure experience”; “No CPA certification is required” must not remain a mandatory requirement.
3. **Recover legitimate work evidence:** support present tense, third-person resume wording and ordinary work verbs without relaxing attribution checks.
4. **Preserve document structure:** connect role titles to adjacent date lines and handle wrapped sentences without inventing employment duration or joining unrelated bullets.
5. **Handle credential chronology and common forms:** explicit renewal should supersede an older expiry of the same credential; conventional degree abbreviations and written quantities need appropriate interpretation.
6. **Separate applicant traits from work context:** ignoring protected applicant characteristics must not erase relevant clinical work because it describes a patient population.

## Failing checks

| ID | Expected distinction | Observed failure |
| --- | --- | --- |
| `word-01` | Present-tense current work is substantive. | not_supported (partial, score 20) |
| `word-03` | Explicit current ownership. | not_supported (partial, score 20) |
| `word-04` | Active current clinical work. | not_supported (unknown, score 0) |
| `word-05` | Third-person resume convention still describes work. | not_supported (partial, score 20) |
| `word-06` | A wrapped PDF line must not change the stated capability. | not_supported (partial, score 35) |
| `word-08` | Responsibility statement describes current implementation. | not_supported (partial, score 50) |
| `word-10` | Executed is a substantive work verb. | not_supported (partial, score 20) |
| `neg-01` | No negates downtime, not the implementation. | not_supported (contradicted, score 0) |
| `neg-06` | Team ownership is not applicant ownership. | supported (supported, score 100) |
| `neg-07` | The substantive work is attributed to someone else. | supported (supported, score 100) |
| `exp-01` | Title and precise dates are on adjacent lines. | not_supported (unknown, score 0) |
| `exp-06` | A clear duration paraphrase. | not_supported (unknown, score 0) |
| `cred-01` | California abbreviation remains a jurisdiction constraint. | supported (supported, score 100) |
| `cred-03` | Explicit renewal supersedes an old expiry for the same license. | not_supported (contradicted, score 35) |
| `cred-07` | Conventional degree abbreviation. | not_supported (unknown, score 0) |
| `cred-10` | Another person owns the credential. | supported (supported, score 100) |
| `scope-06` | Written count and equivalent supervision demonstrate the requested scope. | not_supported (partial, score 0) |
| `scope-10` | Patient demographics must not remove valid work evidence. | not_supported (unknown, score 0) |
| `rubric-02` | No CPA certification is required. | required |
| `rank-01` | Current performed work must outrank a keyword list. | tie |
| `rank-02` | A successful no-downtime outcome must not reverse relevance. | reversed |
| `rank-03` | Personal ownership must outrank someone else’s work. | tie |
| `rank-04` | Equivalent date layouts should preserve seven-year versus two-year evidence. | reversed |
| `rank-05` | Executed work must outrank observation. | tie |
| `invariant-03` | Line wrapping must not change evidence strength. | scores 100 vs 35 |
| `invariant-04` | Patient population wording must not erase clinical work. | scores 100 vs 0 |

## Reproduction and release gate

```sh
node scripts/evaluate-screening-accuracy.mjs > accuracy-results.json
node --test tests/screening-accuracy.test.js
```

The diagnostic command deliberately exits 2 while any expectation fails. The regression test is deliberately red: 26 failing checks plus its failed parent test. The original 344 tests continue to pass; the previous suite did not cover these distinctions. Do not revise expected labels merely to make the tests green. Any label correction needs an explicit rationale and preserved baseline.

Raw synthetic results: [screening-accuracy-challenge-v1-results.json](screening-accuracy-challenge-v1-results.json). No private resume data is committed.

After these defects are fixed, evaluate a fresh untouched challenge set and independently recruiter-labeled pools before making an accuracy claim. Measure call-worthy precision at 20, recovery of recruiter-selected candidates, near-miss recovery and unsupported-qualification claims. Full PDF/DOCX ingestion and live priority generation remain separate quality gates. No production accuracy percentage is established by this report.
