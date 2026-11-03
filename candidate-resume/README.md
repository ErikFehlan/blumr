# blumr Resume

Private candidate studio for issue #157. The candidate reviews a job, imports or pastes a resume, checks the extracted source, reviews proposed wording and ordering, and approves a single-column Word or PDF download. Start with **Try a sample application** to walk through the Azure/AWS example using synthetic data.

## Run the review build

From the repository root, using Node 24 and Python 3:

```sh
cd candidate-resume
npm ci
npm test
npm run build
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist
```

Open http://127.0.0.1:4173. The build requires HTTP for module workers. All runtime dependencies and fonts ship inside the build. No API key is needed for the guest workflow. In CI, the artifact **candidate-resume-private-review** contains the same static build. Serve the unzipped directory on localhost.

## Architecture and delivery plan

The existing recruiter SPA combines workspace login in `assets/auth.js`, private recruiter document records, intake queues, learned manager criteria, scoring, and subscription-gated functions. Routing candidate users through that stack would give them recruiter identity and retention behavior. The recruiter Cloudflare build copies a fixed set of pages and the assets directory. This separate build target is outside that list.

1. Reuse the upload signature/ZIP guard, PDF text ordering, and pure requirement and evidence functions. Evaluate the JD against the local extraction in a Web Worker. No workspace, recruiter ranking, learning system, database query, or recruiter AI call is part of this path.
2. Keep the original file bytes and source text unchanged. Derived lines reference UTF-16 source offsets. Use a short allowlist of wording edits and propose reordering self-contained, adjacent bullets only. Reconstruction from the source enforces full line coverage. Manual edits and additions require confirmation of the exact text. Approval is lost when the application changes.
3. Generate DOCX and PDF in a bounded, disposable worker. Re-extract before offering the download. Compare the complete word stream in order, normalizing layout whitespace only. Reject unrepresentable PDF text or content drift.
4. Optional sign-in and saved versions use a **dedicated candidate Supabase project**. The build rejects both known recruiter project URLs and privileged keys. Optional on-device model assistance returns only existing bullet IDs for the reviewer's attention. It cannot write to the resume. Cache identical requests, coalesce retries, cap the input, and limit sessions to five requests. No hosted model provider, billing integration, paid allowance, or external analytics is configured.
5. Use synthetic fixtures, database policy tests, browser tests and a disposable Supabase integration. Review the hosted staging identity and operational controls before a real-user pilot.

## Data and account controls

Guest work is memory-only and clears on refresh. Save is explicit. Each private, immutable version stores the application snapshot and the unchanged uploaded bytes in the same PostgreSQL row; one insert, expiry or delete covers both. The storage format avoids signed links and orphaned objects. Series of versions are independent snapshots with a maximum of ten per owner. RLS is enforced for reads/deletes and grants prevent assignment of protected columns or updates. Sign-out clears the workspace. Account deletion requires an active session and cascades to all versions. Any provider backup retention is a separate operational policy.

For isolated staging, enable email/password Auth with verified email, disable anonymous signups, configure allowed redirect origins and rate limits, and apply `backend/schema.sql` and `backend/retention.sql` in an empty candidate-only project. Verify pg_cron is running successfully, then build with `CANDIDATE_SUPABASE_URL` and `CANDIDATE_PUBLISHABLE_KEY`. Thirty days is a staging default. Confirm the public retention and backup policy before real-user enrollment. Original files have no public object URLs. Tighten per-IP signup/download limits and confirm abuse monitoring with the pilot traffic budget before general availability.

## Acceptance and launch gates

- Evidence cases cover adjacent clouds, ownership, tenure, credentials, dates, quantified outcomes, quoted source and prompt-like content. A candidate can explicitly attest to a personal fact. The product does not independently verify that person's statement.
- Parsing is conservative. Scans and unsupported Word objects request pasted text. The user checks reading order and missing content after extraction. PDF font coverage and excessively long unbroken strings can limit PDF export; Word remains available. No ATS ranking or interview guarantee is calculated.
- Browser tests cover mobile and desktop upload, review, changed wording, confirmations, both downloaded files, failed upload and retry. Local PostgreSQL tests cover anonymous and cross-owner denial, immutable records, limits, expiry, and deletion. The separate Auth/PostgREST CI job exercises the private account API with synthetic accounts.
- Optional local model review is hidden unless a compatible English on-device model is already available. Provider contract tests use a fake model. Real-device language quality requires separate evaluation before promoting this feature.
- Before hosting, put an identity-based access policy in front of **every** preview hostname and verify an unauthenticated visitor is denied. Use a separate Cloudflare Pages project with only this build output. Keep the recruiter project's settings unchanged. Review complex layouts, accessibility and representative consented samples before launch.
- For rollback, withdraw the candidate deployment or restore a previous candidate build, disable candidate signups, and leave the candidate database private. Restore schema/data only from a verified candidate-specific backup. Production URL, DNS, retention, budget, and any paid launch require owner approval.
