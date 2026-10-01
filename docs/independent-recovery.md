# Independent backup and release controls

## Daily backup

`independent-backup.yml` runs daily at 07:17 UTC and can be started manually. It uses the existing deployment credential to create logical roles, schema and data dumps, and separately downloads every Supabase Storage object. Each download is checked against its recorded byte length and SHA-256 checksum.

All public application tables, Auth users/identities and Storage bucket/object metadata are inventoried in one database statement. Their row counts and content checksums must remain unchanged across the capture. A changing source fails the job instead of accepting an inconsistent backup. This does not promise an atomic point in time spanning the database and Storage.

The archive uses AES-256-GCM; its random encryption key is wrapped with RSA-OAEP-SHA256 using the repository's public recovery key. The private recovery key is held separately by the owner. Credentials and plaintext dumps are excluded from uploaded artifacts and deleted from the private runner directory on exit.

Before retention, the job decrypts the archive locally, checks every recovered file, bootstraps a fresh local Supabase database and stops Auth/Storage services. It disconnects the database's Docker networks before restoring rows, functions, policies and roles. Every inventoried table must match its source row count and checksum. The restored database is destroyed without reconnecting outbound worker endpoints. Only a passing encrypted archive, envelope and aggregate verification report are uploaded to GitHub Actions, with 90-day retention.

GitHub is an independent provider from Supabase, but the backup remains subject to access to this repository and GitHub Actions artifact retention. Cloudflare R2 is currently disabled; it is not used or required by this backup workflow. Workflow failure is visible in GitHub Actions. Check the most recent successful backup date rather than treating an enabled schedule as proof of recovery.

## Owner recovery key

Keep `blumr-backup-recovery.pem` outside this repository. The public key cannot decrypt a backup. Losing the private key makes retained backups unrecoverable. Never put the private key in GitHub, a public artifact, a support message or browser code.

Download all three files from a successful `encrypted-backup-*` artifact: `backup.tar.enc`, `backup.tar.enc.json` and `verification.json`. Check the encrypted archive's SHA-256 against the verification report, then decrypt into an empty private directory:

```sh
node scripts/recover-backup.mjs /private/backup.tar.enc /private/blumr-backup-recovery.pem /private/recovery
```

The command validates authentication of the encrypted content, restricts archive paths, checks the production project identity and verifies every document checksum. It does not restore into production.

Restore into a new isolated Supabase project using the documented CLI roles/schema/data restore procedure. Keep all automated workers and email delivery disabled until the restored data and account/document isolation have been verified. Upload the recovered Storage bytes using `manifest.json`; a database restore alone does not recover these files. Reconfigure new project URLs, independently provision provider credentials and worker Vault secrets, verify isolated sign-in/intake/review, then perform an explicitly planned cutover.

This establishes recovery from new full application snapshots. It cannot recreate an earlier historical timestamp when no retained snapshot or platform backup exists. Platform internals, provider secrets, project settings and Vault root encryption keys require separate configuration; the logical dump is not a clone of Supabase's entire infrastructure.

## Release gate

Cloudflare runs `node scripts/build-public-site.mjs`. Production publication requires successful application and criteria validators, isolated staging verification, and core backend validation/deployment for the exact commit. Missing, failing, unavailable or timed-out evidence blocks publication. No database rollback is performed automatically.

Preview builds require the isolated staging public key. Authentication, AI defaults and the browser connection policy all use the staging project. Production account data is never copied to staging. Staging uses the same repository migrations and handlers, then verifies live permission/intake/review/provider paths and checks structural parity.

Application validation is limited to 12 minutes; browser installation is limited to four minutes. Hosting checks wait up to 15 minutes. If a valid release takes longer, retry the hosting deployment after its required checks pass. A stalled run cannot silently publish production.
