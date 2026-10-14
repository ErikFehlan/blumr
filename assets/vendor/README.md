# Resume preview dependencies

- `docx-preview-0.3.6.min.js`: docx-preview 0.3.6, Apache-2.0, from the npm package's `dist/docx-preview.min.js`.
- `jszip-3.10.1.min.js`: JSZip 3.10.1, MIT option, from the npm package's `dist/jszip.min.js`.

Both are pinned, included with their licenses, and loaded only inside the sandboxed Word viewer when requested. The Word document never leaves the browser. PDF rendering reuses the app's existing pinned PDF.js 4.10.38 CDN dependency.

Word rendering cannot guarantee Microsoft Word pagination/font parity. The original file download is always available when private storage retrieval succeeds. HTML altChunks, external network resources, document navigation and parent-origin access are disabled.
