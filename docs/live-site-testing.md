# Live blumr checks

`Verify live blumr site` checks https://blumr.io after each successful main release. It waits for Cloudflare Pages to report success for that same commit and verifies the served HTML, JavaScript and CSS against the checked-out files. A superseded commit is explicitly skipped. A failed deployment, TLS failure, stale files, failed test, or failed cleanup does not count as a verified release.

A manual run is available in GitHub Actions on main. The `test/live-site-ci` development branch runs only the public connectivity probe and cleanup guard tests, with no production credentials.

## Access

The existing `criteria-backend` environment supplies `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF`. No new user-managed passwords or Cloudflare API token are required. Administrative credentials are available only to fixture setup/cleanup. The browser step receives temporary non-admin account credentials through a private file in the runner's temporary directory. It never receives the Supabase management token or service-role key.

Each run creates two synthetic accounts and separate workspaces. All document and candidate content is synthetic. Account creation uses the existing beta approval mechanism and sends no mail. No real recruiter or candidate records are used. Production limits and security settings remain in force. Real model calls consume normal AI usage (two resume assessments plus job/feedback processing).

## Coverage

- Normal HTTPS, public startup and sign-in controls.
- Actual password login to the current Home screen.
- UI job creation and persistence; all standard navigation tabs.
- Text-based PDF and DOCX uploads, text extraction and private storage.
- Real durable AI intake, grounded resume quotes and explicit approval before scores persist.
- Manager feedback saving and AI interpretation.
- Submittal editing, persistence and page reload.
- Mobile navigation and basic overflow check.
- Separate-account record isolation and sign-out.

Email delivery and recovery-link completion, scanned PDF OCR, other browsers and exhaustive mobile coverage are not yet tested.

## Results and cleanup

Open GitHub Actions → Verify live blumr site. The summary lists completed checks and cleanup status. Download `live-blumr-results` for screenshots and `results.json`; artifacts expire after seven days. Password fields are masked in screenshots. No network traces, browser storage state, request bodies or credential files are uploaded.

Cleanup runs even after test failure. It verifies the generated email and run marker against the actual account, refuses workspaces containing other members, deletes only that workspace's resume objects, then removes the temporary account (which cascades its workspace and rows). It verifies account/workspace removal and deletes the temporary beta approval. An interrupted creation response can be recovered by the run marker. A cleanup failure fails the workflow and logs only the synthetic account identifier for follow-up. A forcibly terminated runner can still require manual cleanup; investigate any cancelled run that did not complete the cleanup step.

Tests run after publication. They detect release failures; they do not currently block Cloudflare's initial deployment or perform automatic rollbacks.
