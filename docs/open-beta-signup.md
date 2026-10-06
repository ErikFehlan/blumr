# Open beta signup

New users register with email/password, confirm their email and receive a private
workspace on the active, free `beta` plan. No email needs to be added by an admin.
The existing per-workspace and global usage budgets still apply.

`scripts/security-backend.mjs prepare` installs the historical security baseline,
restores the paid-plan budget implementation, then applies
`supabase/patches/open-beta-signup.sql`. Keep that final patch when refreshing the
baseline: it replaces the old approval hook and trigger. Auth remains configured
for email confirmation, twelve-character passwords and no anonymous sign-ins.
Existing SMTP, CAPTCHA and rate limits are preserved.

Registration binds an account-control row atomically with Auth account creation.
Existing suspended rows are never reactivated by signup or deployment. Existing
RLS checks still require verified email, active access, workspace membership and
no ban/deletion lock. Client metadata grants no administrator privileges. Admins
manage registered accounts in the Users panel and can suspend or restore access.

Verification:

- `node --test tests/*.test.js` checks the application and deployment invariants.
- `tests/beta-security.sql` tests open admission, verification, private data,
  forged metadata, quotas, suspension and repeat deployment in isolated Postgres.
- `tests/open-beta-signup-live.sql` exercises the complete schema with synthetic
  accounts, a job and candidate, then rolls everything back.
- `scripts/security-live-smoke.mjs` runs that transaction and creates a disposable
  Auth signup confirmation token without an approval row or outbound email. It
  tests unverified-login rejection, token verification/replay, password login,
  the free plan, admin denial, AI quotas and existing-session suspension.
- Landing/admin browser tests cover signup instructions, confirmation guidance,
  retained email, and account suspension/restoration without an invite form.
- The existing staging and production release workflows run these checks and
  the full recruiter journey. Core test accounts also skip prior approval.

Confirmation-token tests do not prove delivery into a recipient's inbox. Existing
branded-email configuration checks still run; inbox delivery is a separate check.
