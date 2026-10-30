# Document and browser security hardening — October 30, 2026

The live Word text extractor used Mammoth 1.8.0. Replace it with the integrity-verified npm release of Mammoth 1.13.0, including the upstream prototype-pollution and parser denial-of-service fixes. The bundle and license are hosted with the application. A fresh worker receives only document bytes, validates the archive again, disables external file access, returns bounded plain text and terminates on completion, error or a 15-second timeout. The worker's HTTP Content Security Policy denies network connections. There is no fallback to parsing in the authenticated page.

Cloudflare Pages now receives a tracked `_headers` file in production and staging builds. `frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN` reject cross-origin embedding while preserving the sandboxed original Word preview. Responses also carry HSTS, nosniff and the existing referrer policy. The worker has an additional restrictive CSP. Existing page-level script policies remain in force.

Cloudflare zone settings were hardened to minimum TLS 1.2, Always Use HTTPS, Full (strict) origin validation and HSTS with a 15,552,000-second lifetime. Subdomain inclusion and preload remain off because the zone also has independent mail/link service hosts. HTTPS availability was checked after enabling strict validation.

Verification includes real browser Word extraction, worker network blocking, allowed same-origin preview, denied cross-origin framing, timeout/crash cleanup, archive guards and checksums. Production release verification checks the actual served parser bytes and browser/worker headers. All existing application and release gates remain required. No AI release flags, scheduler states, subscriptions, users or beta access records are changed.

## Authentication follow-up

Production organization `iiphfdoyaonoyhjxazqx` is on Supabase Free as checked October 30. Native leaked-password protection requires Pro or above and remains disabled pending approval of the recurring plan cost. This change does not substitute a browser-only password check or report the finding as fixed. Existing email verification, disabled anonymous sign-in and 12-character minimum are retained.

## References

- https://raw.githubusercontent.com/mwilliamson/mammoth.js/master/NEWS
- https://developers.cloudflare.com/pages/configuration/headers/
- https://supabase.com/docs/guides/auth/password-security
