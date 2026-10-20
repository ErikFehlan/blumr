# Recruiter holdout evaluation

The bulk workflow has a real 500-resume staging result. That establishes functionality and measured cost/latency for synthetic inputs; it does not establish recruiting accuracy. The next quality gate requires independent human labels, which development tests cannot manufacture.

## Prepare and freeze the evaluation

Use authorized, de-identified application pools for at least five distinct roles across multiple occupations. Aim for 100–200 resumes per role, retaining ordinary weak, unclear, transferable and strong applications rather than curating only easy examples. Record the exact job description, approved Top 5 priorities and permitted manager feedback before reviewing candidates. Keep protected applicant characteristics out of scoring and labeling criteria.

Two recruiters independently assess the entire pool without seeing engine scores, rank or explanations. For each candidate record:

- An opaque candidate ID and job ID.
- Whether the available job-related evidence warrants a phone screen: yes, no, or uncertain.
- Whether each mandatory qualification is evidenced, contradicted, or unestablished, with exact supporting source passages.
- Transferable evidence and the questions needed to resolve uncertainties.

Adjudicate disagreements before running the frozen engine. Do not treat uncertain or unestablished qualifications as proven negatives. Retain disagreements and adjudication reasons rather than silently changing labels after seeing results. Keep this holdout separate from examples used to tune vocabulary, interpretation or weighting.

## Report quality and speed together

Measure each role separately before any pooled summary:

| Metric | Definition |
| --- | --- |
| Phone-screen precision at 20 | Recruiter-labeled yes candidates among the first 20, with uncertain labels separately reported |
| Qualified recovery at 20 | Labeled yes candidates in Top 20 divided by all yes candidates in the pool |
| Recovery including near misses | Labeled yes candidates in Top 20 plus the near-miss pool divided by all yes candidates |
| Missed candidates | Every yes candidate below both pools, with the requirement/evidence interpretation that affected ranking |
| Unsupported interpretations | Findings that claim a qualification not established by the cited passage; report separately from literal quote matching |
| Priority fidelity | Recruiter review of whether generated priorities, mandatory/preferred status and weights reflect the frozen job sources |
| Document coverage | Readable, failed, low-confidence OCR and unusual-layout counts, with failures kept out of final-ranked denominators until resolved |
| Performance and cost | Upload acknowledgment, first provisional results, completion, cached reranking, deep-analysis duration, calls, tokens, recorded cost and unsettled reservations |

If a pool contains more than 20 qualified candidates, recall at 20 is necessarily limited; interpret it with the pool's qualification count and near-miss recovery. Report small samples and uncertainty openly. Do not convert agreement on these fixtures into a universal hiring-accuracy percentage.

Agree on acceptable quality thresholds before execution. Any material change prompted by this holdout needs a new untouched evaluation set; rerunning the tuned-on examples is regression verification, not independent validation. Compare with the existing engine on the same authorized sources where valid prior results exist, identifying differences in model, dates and context. Do not purchase 500 duplicate full assessments merely to produce a hypothetical cost baseline.

No automatic rejection or employment decision is part of this evaluation. Recruiters retain final decisions and can promote candidates from outside the initial shortlist.
