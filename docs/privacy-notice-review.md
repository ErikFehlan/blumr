# blumr privacy notice — publication review draft

Prepared September 28, 2026. **Do not publish as a final notice until the owner confirms the bracketed details and the retention/deletion inventory.** This draft describes the current application; it is not a claim of legal compliance.

## Who operates blumr

blumr is operated by **[confirm: Erik Fehlan, doing business as blumr, or the exact registered entity name and mailing address]**. For privacy questions or deletion requests, contact **efehlan@proton.me**.

## What information the service handles

When recruiters use blumr, it handles account identifiers and sign-in information; workspaces, jobs, job descriptions and hiring priorities; uploaded resumes, extracted resume text, candidate profiles and documents; recruiter notes, manager feedback, assessments, evidence decisions and submittal drafts. Candidates' resumes and notes may contain personal information supplied by a recruiter. The application also records operational information such as usage, AI request tokens and error events. **[Verify production telemetry, logging, IP address and cookie inventory before publishing.]**

## How information is used and shared

The service uses this information to authenticate accounts, provide recruiter workspaces, store and display candidate records, extract text from documents, generate AI assessments and hiring priorities, record recruiter decisions, enforce access and usage limits, troubleshoot and secure the service. Resume/job/feedback content needed for an AI feature is sent from the server to OpenAI's API for processing. AI output may be mistaken; recruiters can review and correct it. The current requests inspected use `store: false`; this setting does not establish zero provider retention or erase provider abuse logs. Supabase provides authentication, database and private file storage; Cloudflare serves the website. **[Verify any other providers, support tools, analytics, email sender and contractual terms before publishing.]**

blumr does not make a hiring decision for a recruiter. Recruiters remain responsible for having a lawful basis and any required notices or permission to upload candidate data and for deciding how to use its output. **[Have counsel confirm contractual controller/processor roles, jurisdiction-specific candidate rights and employment/AI obligations.]**

## Access, security and deletion

Access to candidate information is limited by workspace membership and application controls. Users can delete their accounts in Settings after password confirmation. Account deletion initiates removal of private workspace records and stored resume files, subject to shared workspace ownership and completion of deletion processing. **[Confirm database backup, provider log, security log and export retention before describing a deletion deadline or complete erasure.]** Users should ask their workspace owner about records in a workspace they do not own; privacy requests may be sent to **efehlan@proton.me**. blumr retains active workspace records until they are deleted by an authorized user or under **[approved retention schedule]**. **[Decide inactive-account and terminated-workspace periods, backup expiry and statutory exceptions.]**

## Changes and contact

This notice should be dated when approved, with material changes communicated through **[chosen communication channel]**. Contact **efehlan@proton.me** with questions or requests.

## Required owner review before publication

- Confirm whether Erik Fehlan operates as an individual/sole proprietor or through a registered entity, its exact legal name and mailing address; confirm `efehlan@proton.me` will receive and be monitored for privacy requests.
- Approve retention and deletion periods for active records, inactive accounts, backups, provider logs and operational logs; verify account deletion behavior for shared workspaces.
- Inventory browser cookies, authentication storage, IP/error logs, analytics, SMTP, OCR dependencies and any support tooling actually used.
- Review the recruiter-to-candidate notice/consent terms and rights requests with counsel for the markets served.
- Confirm OpenAI and Supabase data processing and retention terms for the actual accounts. Do not claim zero retention based on `store: false`.
- Approve final wording and publish a public page linked from account creation and the site footer; verify the published URL.
