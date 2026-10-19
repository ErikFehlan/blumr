# Evidence interpretation repair — October 19, 2026

The known interpretation failures are fixed in the development branch. This is
not a production accuracy claim or authorization to deploy. PR #120 stays draft.

## What changed

The shared screener now interprets the actor, local action, responsibility depth,
negation and modality of source statements. It distinguishes personal work from
team/manager/vendor statements; present tense, inflections and ordinary work verbs
from tool lists; and performed work from requirements or hypothetical plans.
Repeated capability mentions are checked so an earlier team mention does not hide
a later personal statement. Term evidence exposes these interpretation fields.

Source quotations remain exact substrings. Conservative line continuation keeps
wrapped prose together without joining separate bullets. Adjacent role titles
can qualify dated occupational episodes; overlapping periods count once and a
heading combining several unspecified roles does not establish a full period in
one occupation. Work dates still do not establish years using every listed tool.

Credential matching preserves jurisdiction abbreviations, conventional degree
forms, specific credential identities and date precision. Only an explicitly
dated later renewal resolves an older invalidity of the required credential and
jurisdiction. Future renewals, undated conflicts and later revocations remain
unverified. Credentials are resume claims, never independently verified licenses.

Written quantities retain their activity scope: training twenty engineers does
not mean managing twenty engineers. Clinical patient-population wording no longer
erases valid assessment work; applicant protected characteristics remain excluded.
Manager statements such as “No CPA certification is required” remove the mandatory
classification. No applicant is automatically rejected.

Versions `screening-v4`, `job-requirements-v2` and `screening-vocabulary-v2` enter
the existing rubric fingerprints, invalidating older cached interpretations.
Parsing and interpretation caches are bounded or tied to passage lifetimes.
No new provider requests, schema migrations, auth exceptions or dependencies.

## Verified local results

| Evaluation | Before | After |
| --- | ---: | ---: |
| Original synthetic challenge | 44/70 | 70/70 |
| Additional synthetic challenge | 23/40 | 40/40 |
| Private source checks, three real documents | 12/18 | 18/18 |
| Original six ranking comparisons | 1/6 | 6/6 |

The same original expectations and private resume texts were retained. Of the
original 52 qualification checks, all 29 supported statements now receive support
and all 23 unestablished qualifications withhold full support. The additional 40
checks contain 15 supported and 25 unestablished statements; all pass.

The private audit now recognizes all 11 documented qualifications and withholds
full support for all seven unestablished qualifications. It remains a source
evidence audit, not a whole-job assessment. No private names, identifiers, resumes
or quotations are in this repository.

The complete local Node suite passes **473/473** tests, including 15 additional
code-review boundary checks and their parent, plus a report-portability check. All returned challenge/private
evidence quotes occur in their sources. Screening provider calls: **0**; screening
provider cost: **$0**. These figures exclude the coding assistant's own operation.

The additional challenge labels were authored and executed on the old engine
before changes, then used during development. Both synthetic suites and the
private audit are assistant-authored diagnostic labels, not independent recruiter
ground truth, held-out accuracy measurements or random applicant samples. Passing
them demonstrates regression repair, not universal language understanding.

## Local CPU tradeoff

The extra interpretation work costs CPU. Interpretation results are reused within
a parsed passage, but this repair is **not a speed improvement**. The same local
benchmark measured the following medians for 1,000 resumes with five priorities:

| Occupation | Before: parse + score + rank | After: parse + score + rank | After: already parsed |
| --- | ---: | ---: | ---: |
| cloud | 1.04 s | 1.33 s | 0.94 s |
| accounting | 0.96 s | 1.01 s | 0.62 s |
| clinical | 1.02 s | 2.19 s | 1.28 s |
| warehouse | 0.64 s | 1.10 s | 0.70 s |
| education | 0.49 s | 0.89 s | 0.57 s |
| maintenance | 0.95 s | 1.84 s | 1.14 s |
| qa | 0.79 s | 1.29 s | 0.83 s |

These are three samples per occupation/size, synthetic repeated profiles and local
CPU timings. They exclude database, network, upload, document extraction, UI and
model time. Already-parsed scoring is not the durable result-cache lookup path.
The full 20/100/500/1,000 measurements and source hashes are in
[screening-evidence-performance.json](screening-evidence-performance.json). No
provider calls were made in either run. Hosted speed still requires measurement.

## Reproduce

```sh
node --test tests/*.test.js
node scripts/evaluate-screening-evidence.mjs > evidence-results.json
node scripts/benchmark-screening-qualifications.mjs > qualification-timing.json
```

The original failed baseline is preserved in
[screening-accuracy-challenge-v1-results.json](screening-accuracy-challenge-v1-results.json).
The added challenge baseline is in
[screening-evidence-follow-up-before.json](screening-evidence-follow-up-before.json).
The repaired results and source hashes are in
[screening-evidence-after.json](screening-evidence-after.json).
When generated before committing, the report explicitly identifies modified
working-tree sources and records their hashes instead of attributing them to the
old commit. All public fixtures are invented.

## Hosted validation and report portability

The first hosted rules-validation job passed the Node, Deno and PostgreSQL gates.
The separate browser container rejected Git ownership metadata while building the
diagnostic report. The reporter now marks revision metadata unavailable when Git
cannot provide it, retaining file hashes and executing every quality assertion.
It does not change Git ownership protections. A regression runs all 70 checks from
a directory without Git metadata. Final hosted run status is tracked on PR #120.

## Remaining release gates

Live model-generated Top 5 quality, blumr's actual PDF/DOCX extraction and
independently recruiter-labeled full pools remain separate quality gates. Test
call-worthy precision at 20, recall of recruiter-selected candidates, near-miss
recovery and unsupported qualification claims across occupations. The 18 private
checks used already extracted document text and do not validate the import UI.

Full bulk import, durable upload recovery, recruiter shortlist/override UI,
selective finalist AI and separate Top 10, and batch spending controls remain
unfinished. Hosted latency and production accuracy are not established by local
CPU measurements. Production remains unchanged.
