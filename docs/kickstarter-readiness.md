# Kickstarter technical readiness — September 28, 2026

This is an evidence log, not a claim that blumr or a Kickstarter campaign is ready to launch. The campaign promises a finite recruiter-ready release; unfinished reliability and independent security work must be shown as funded work, not as completed tests.

## 1. Unit costs

- Admin → AI cost coverage shows the last 30 days of provider responses by workspace and initiating recruiter, recorded calls without an actor, unpriced model calls, and only the **priced portion** of estimated provider cost. A completed product operation is a separate count and is not a provider bill.
- Rate entry is manual. Verify rates against provider invoices and pricing at the time of the campaign; historical rows cannot be attributed retroactively. Telemetry is best effort and the cost report excludes unrecorded requests, OCR, infrastructure, email, support, taxes and failed requests lacking a response.
- No reward quota or funding target should be published from this partial ledger alone. Collect several weeks of realistic work and reconcile the provider invoice with logged tokens before setting access caps.
- September 28 follow-up: the production ledger holds 17 provider responses in the last 30 days, all from before actor attribution; there are no newly attributed responses to use for a per-recruiter estimate yet. Wait for actual normal usage and reconcile invoices. Do not create artificial calls merely to fill this gap.

## 2. Reward access

- `admin_grant_reward_access` grants one workspace a verified reference, 1–5 seats, monthly AI reservation allowance, and future end date. It does **not** collect payment or verify a pledge; an administrator must check eligibility separately before calling it. The reference is unique and regranting a different reference to the same workspace is rejected.
- A database trigger enforces the reward seat cap, including service-role inserts. Existing beta teams have no reward seat cap. The existing plan check stops new AI reservations after the end date and preserves saved work. The existing monthly counter is a shared workspace allowance, counting reservations and retries, rather than a promise of completed assessments.
- On staging, `tests/kickstarter-readiness.sql` passed in a rollback transaction: unauthorized report access was rejected, priced/unpriced and attributed/unattributed counts were correct, a second member was blocked, and a past end date was rejected. Staging remained empty afterward.
- September 28 follow-up in staging: a second rollback transaction granted a two-seat, one-call-per-month synthetic reward. The owner and invited member both read the plan; the owner could pause it and still read the plan; the backend denied AI reservations while paused and after expiry. The synthetic grant and accounts rolled back; staging has zero reward grants. The test did not create a browser session or verify an actual model call, so live UI provisioning and a normal quota-use path remain to verify.
- Before sending rewards, exercise manual provisioning with a synthetic backer identity; confirm the owner sees the plan, a permitted teammate can join a multi-seat reward, and paused/expired access still permits viewing retained work. Reconcile the final Kickstarter reward wording with the chosen seat and allowance rules.

## 3. Live workflow and interruptions

- The September 28 main-branch release browser job passed HTTPS/startup, login, job creation, PDF/DOCX/scanned-PDF uploads, evidence review, feedback, persistence, account separation, recovery-link flow and synthetic cleanup. It made a small number of real model calls. It did not verify actual confirmation or reset email delivery; the SMTP delivery gap in `docs/live-site-testing.md` remains.
- Existing local tests cover durable retries, stale revisions, lost successful saves, separate workspaces and deletion safety. Run the production release browser after the new deployment, check synthetic cleanup and repeat interrupted-upload/worker tests in a safe environment. Do not claim every failure mode is covered.

## 4. Ordinary concurrency

- The production canary now defaults to **zero AI calls** and stages 5, 25 and 50 preauthenticated synthetic accounts reading isolated jobs, candidates and feedback. It checks cross-workspace isolation and cleans up its empty workspaces before Auth deletion. It does not measure concurrent uploads or sign-ins because one shared runner IP would distort Auth rate limits; label those as separate tests.
- Run the canary only after reviewing its production scope and cleanup. Record response failures and p95 latency for each stage. A pass on read traffic does not prove 50 simultaneous AI assessments or upload processing, and no such AI test is requested.

## 5. Campaign demo

- There is already a 90-second **illustrative** product walkthrough at `how-it-works.html` (`assets/blumr-demo-90s.mp4`). It uses fictional profiles and labels itself illustrative. It is not evidence of a recorded live workflow; use it as a visual explainer only.
- September 28: a 49-second **real frontend capture with a simulated backend** was recorded from the current branch with fictional data. It shows job creation, five priorities, resume evidence, an unsupported concern and a saved reviewer decision. The recording labels the simulated AI result, and its capture log confirms zero provider calls. It is a review copy, not a live production end-to-end recording or proof of actual model output. The browser capture is reproducible via `scripts/record-campaign-demo.cjs` and `.github/workflows/campaign-demo.yml`.
- Film a synthetic 90-second flow: create a job; inspect its five priorities; upload a synthetic resume; review strengths, concerns and exact source evidence; correct or mark unsupported; show the saved recruiter decision. Verify those steps against the deployed version and record the commit/date used.
- Reuse `tests/fixtures` and the passing live browser journey as a baseline. The actual campaign video, captioning, founder footage and final feature-status labels remain to be produced. No real client or candidate information belongs in campaign footage.

## 6. Privacy and security claims

- `docs/privacy-notice-review.md` now contains a factual working draft and an owner review list. It is not approved public legal copy; legal operator/contact, actual retention periods, provider terms and candidate notice obligations still require confirmation.
- The database report requires app-admin status and never exposes candidate or resume text. Normal account/workspace data still uses the existing beta approval and membership rules. The staging test checks the report permission gate; release tests check cross-workspace isolation.
- Before launch, review the published privacy notice against actual provider requests, data retention, account deletion, storage and consent, and Kickstarter's AI-project disclosures. Do not describe candidate data as training data or claim a completed independent security assessment without evidence. The independent review and backup restoration drill remain funded work in the campaign draft; the latter is paused per owner direction.
- Repository inspection found no public privacy or terms page linked from the application. A reviewed public notice covering candidate data and the AI provider is a **campaign launch gap**; this technical checklist is not a substitute for that notice. Confirm controller/business identity, contact address, retention periods, data deletion language and applicable customer obligations before publishing legal copy.

## Release sequence

1. PR validation and browser checks; staging migration/rollback tests.
2. Coordinate production migrations before backend and frontend deploy; verify all existing workspaces stay active beta and no reward cap applies to them.
3. Deploy, run the live recruiter flow and no-AI concurrency canary, verify synthetic cleanup and admin cost report.
4. Reconcile observed AI spend and reward costs, record the synthetic demo, then finalize campaign copy, disclosures and budget.
