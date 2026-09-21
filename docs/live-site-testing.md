# Live blumr checks

`Verify live blumr site` checks https://blumr.io after main's application checks and backend deployment succeed. The release workflow calls it alongside the legacy GitHub Pages publishing job, so that job cannot delay or prevent the live check. It waits for Cloudflare Pages to report success for that same commit and verifies the served HTML, JavaScript and CSS against the checked-out files. A superseded commit is explicitly skipped. A failed deployment, TLS failure, stale files, failed test, or failed cleanup does not count as a verified release.

A manual run is available in GitHub Actions on main. The `test/live-site-ci` development branch runs only the public connectivity probe and cleanup guard tests, with no production credentials.

## Access

The existing `criteria-backend` environment supplies `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF`. No new user-managed passwords or Cloudflare API token are required. Administrative credentials are available only to fixture setup/cleanup. The browser step receives temporary non-admin account credentials through a private file in the runner's temporary directory. It never receives the Supabase management token or service-role key.

Each run creates two synthetic accounts and separate workspaces. All document and candidate content is synthetic. Account creation uses the existing beta approval mechanism and sends no mail. No real recruiter or candidate records are used. Production limits and security settings remain in force. Real model calls consume normal AI usage (three resume assessments plus job/feedback processing).

## Coverage

- Normal HTTPS, public startup and sign-in controls.
- Actual password login to the current Home screen.
- UI job creation and persistence; all standard navigation tabs.
- Text-based PDF and DOCX uploads, text extraction and private storage.
- Two-page, image-only PDF OCR with mild scan tilt and JPEG compression. The browser independently confirms that both source pages have zero extractable text, then checks recognized phrases from both pages, saved source text, AI evidence and approval. The generator is `tests/fixtures/generate-scanned-resume.py`; the committed PDF needs no Python at runtime.
- Real durable AI intake, grounded resume quotes and explicit approval before scores persist.
- Manager feedback saving and AI interpretation.
- Submittal editing, persistence and page reload.
- Mobile navigation and basic overflow check.
- Separate-account record isolation and sign-out.
- A genuine recovery link for the disposable second account returns to blumr.io, opens the reset form, saves a new password, rejects the previous password and signs in with the new password. Setup generates this link with the Auth admin API; this deliberately does **not** send email or establish inbox delivery. The temporary link is masked and never uploaded in artifacts.

Inbox delivery, handwriting, heavily degraded or non-English scans, other browsers and exhaustive mobile coverage are not yet tested.

## Email delivery follow-up

Inspection on September 21, 2026 found custom SMTP disabled in Supabase Authentication > Emails > SMTP Settings. The default sender restricts delivery to project-team addresses and is unsuitable for ordinary beta-tester delivery. See [Supabase's SMTP documentation](https://supabase.com/docs/guides/auth/auth-smtp).

To verify inbox delivery, choose an address controlled by the owner/tester and an authorized sending configuration. Send one recovery request through blumr's Forgot email or password flow. Confirm the message actually arrives (including the spam folder), record elapsed time and sender identity, and follow its link back to blumr. A successful API response alone is not delivery evidence. Completing a reset on a real account remains the account owner's action; use a disposable approved account for repeatable end-to-end testing. Confirmation-email testing similarly requires a new disposable address and inbox access. Never publish reset links, passwords, or email bodies containing tokens in CI logs.

## Results and cleanup

For automatic runs, open the release workflow's `live-site / release-browser` job; for manual runs, open GitHub Actions → Verify live blumr site. The summary lists completed checks and cleanup status. Download `live-blumr-results` for screenshots and `results.json`; artifacts expire after seven days. Password fields are masked in screenshots. No network traces, browser storage state, request bodies or credential files are uploaded.

Cleanup runs even after test failure. It verifies the generated email and run marker against the actual account, refuses workspaces containing other members, deletes only that workspace's resume objects, then removes the temporary account (which cascades its workspace and rows). It verifies account/workspace removal and deletes the temporary beta approval. An interrupted creation response can be recovered by the run marker. A cleanup failure fails the workflow and logs only the synthetic account identifier for follow-up. A forcibly terminated runner can still require manual cleanup; investigate any cancelled run that did not complete the cleanup step.

Tests run after publication. They detect release failures; they do not currently block Cloudflare's initial deployment or perform automatic rollbacks.
