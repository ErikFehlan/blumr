# Automatic knowledge for new searches

New searches automatically receive relevant, source-backed context from previous searches. There are no additional wizard steps, mandatory approvals, learning forms, or background model requests. Optional custom lessons continue to work. The existing human decision about a candidate remains the same.

## Capture and reuse

Database triggers inspect original manager feedback, screening notes, interview notes and explicit recruiter corrections when they are saved. Generated summaries, candidate scores and interview/pass decisions are not learning evidence. Original recruiter corrections survive a later reassessment wrapper. Edited/deleted sources are re-read; generated interpretations cannot confirm themselves.

The first catalog shares the transferability engine's tool/workflow relationships, plus three bounded client preferences: hands-on engineering, personal ownership and stakeholder communication. Transfer observations require explicit confirmation language and an expressed relationship between the two skills. Questions, hypothetical statements and recognizable instruction attacks do not become confirmations. This deliberately captures only clear statements; it does not infer arbitrary new rules from every note or train model weights.

A pattern becomes reusable after positive observations across at least three distinct candidates and two jobs, with at least two distinct normalized excerpts, and no contradictory observations in the last 180 days. These are conservative operational thresholds, not measured statistical confidence. The historical source text is retained with its existing private candidate records; the new job receives only a bounded template, aggregate counts and a screening question.

Role families are resolved in code, with explicit seniority boundaries. Relevant targets must appear in the current job context. Transfer methods stay within the workspace; preferences additionally require the same nonempty normalized client name. We do not infer manager identities from free text. Unknown role titles match conservatively. Current job requirements and manager instructions take precedence; historical preferences remain soft Manager Fit context, not extra JD requirements or knockout rules.

## Lifecycle and cost

A job snapshots up to six eligible rules when it is created or its title, description, criteria, manager notes or client changes. Growth in historical evidence does not mutate every existing job or enqueue assessments. Eligibility is rechecked on use, so source deletion, contradiction, expiry or a source job's changed scope removes stale context. Each applied rule carries its catalog version. Exclusions persist through ordinary job edits.

The installation captures existing recent human history once, without refreshing existing jobs. No model call is made by capture, matching, retrieval, snapshotting or exclusion. The authenticated assessment path reuses its existing memory lookup. Code-first job intake remains code-first. Existing assessment prompts can grow by at most six short rule templates; request count is unchanged, while token usage can rise modestly.

The private `blumr_knowledge` schema holds the catalog, observations and job snapshots. Clients cannot write or read those tables directly. Three authenticated, workspace-checked RPCs expose applicable job context and a single-action exclusion. All security-definer functions pin an empty search path; internal execution is revoked from public, anon and authenticated.

## Interface

The job wizard keeps its four existing steps and applies eligible context after save. The existing learning panel shows automatically used patterns and an optional **Doesn't apply here** action. Removing a pattern changes future assessment context; it does not start a new model request or rewrite a saved candidate score. Assessment explanations label actually applied automatic context separately from candidate evidence. Automatic learning is excluded from both criterion and priority evidence citation lists.

## Validation and rollback

`tests/automatic-knowledge.sql` exercises normal feedback capture, role/client/workspace isolation, independent candidate/job counts, duplicates, contradictions, source deletion, expiry, generated-output exclusion, manual correction preservation, snapshots, private privileges, exclusions and unchanged assessment queues/scores. It runs with native Postgres in the existing core CI gate; a local PostgreSQL WASM run checks the same SQL during development.

Node and backend tests verify context routing, forged-client removal, evidence separation, the shared catalog, unchanged job steps and unchanged provider-call count. The browser suite verifies automatic display and single-action exclusion while retaining the existing journey. The staging/production core smoke test creates disposable closed jobs, verifies automatic capture/new-job reuse and isolation with zero AI usage events, then deletes the fixtures. The existing transfer model preflight now includes automatic context without adding another model call.

To disable automatic use while retaining collected observations, an operator can replace `blumr_knowledge.for_job(uuid)` with a function returning an empty JSON array; manual approved lessons remain available. Apply changes through the normal migration/release path. Actual quality improvements still require evaluation against independent real-world recruiter and screening outcomes.
