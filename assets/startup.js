(function () {
  'use strict';
  let ready = false, failed = false;

  function showFailure() {
    const panel = document.getElementById('startupProblem');
    if (!panel) return;
    panel.hidden = false;
    // A failed initialization must not leave a permanent loading overlay.
    document.body.classList.remove('rf-data-loading');
    document.getElementById('rf-app').inert = true;
  }

  window.addEventListener('error', function (event) {
    if (ready) return;
    const source = event.target;
    const localScript = source?.tagName === 'SCRIPT' && source.src.startsWith(new URL('assets/', document.baseURI).href);
    if (localScript || (event.filename && event.filename.startsWith(new URL('assets/', document.baseURI).href))) {
      failed = true;
      showFailure();
    }
  }, true);
  window.addEventListener('blumr:ui-ready', function () {
    ready = true;
    if (failed) showFailure();
  }, { once: true });
  document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('startupReload').addEventListener('click', function () { window.location.reload(); });
    if (!ready || failed) showFailure();
  }, { once: true });
})();
