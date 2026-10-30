# Resume processing dependencies

- `docx-preview-0.3.6.min.js`: docx-preview 0.3.6, Apache-2.0, from the npm package's `dist/docx-preview.min.js`.
- `jszip-3.10.1.min.js`: JSZip 3.10.1, MIT option, from the npm package's `dist/jszip.min.js`.

Both are pinned, included with their licenses, and loaded only inside the sandboxed Word viewer when requested. The Word document never leaves the browser. PDF rendering reuses the app's existing pinned PDF.js 4.10.38 CDN dependency.

Word rendering cannot guarantee Microsoft Word pagination/font parity. The original file download is always available when private storage retrieval succeeds. HTML altChunks, external network resources, document navigation and parent-origin access are disabled.

- `mammoth-1.13.0.min.js`: Mammoth 1.13.0, BSD-2-Clause, from `package/mammoth.browser.min.js` in the npm release. Includes the 1.12.2 prototype-pollution and 1.12.3 parser denial-of-service fixes.
  - npm archive SHA-512: `2cawcYFcP7ISfXbBcL9lmVgTNWo88v/52ND1gnywHtVT/pX0//puPnf0iMPV9ZgmuvNOE+zkIhDgZ9M2c2dDDg==`
  - browser bundle SHA-256: `92914a3708cfdf1e62cb553d1856a7fedab21da83d8ee82845de2f897b368cab`
  - Loaded locally only by a disposable text-extraction worker. Its response CSP blocks network connections, external file access is disabled, and the parent terminates it after 15 seconds or one result. Input is limited to 10 MiB and output to 800,000 characters. No runtime CDN fetch is used for Word extraction.
