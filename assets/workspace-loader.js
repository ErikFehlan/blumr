(function () {
  'use strict';

  const sources = [
    'assets/hiring-priorities.js?v=20260924-priorities',
    'assets/data.js?v=20260924-priorities',
    'assets/select.js?v=20260910-dark-dropdowns',
    'assets/presentation.js?v=20260917-concise',
    'assets/evidence.js?v=20260911-quick-feedback',
    'assets/context.js?v=20260924-priorities',
    'assets/assessment-memory.js?v=20260924-priorities',
    'assets/scoring.js?v=20260911-quick-feedback',
    'assets/quality.js?v=20260915-core',
    'assets/quality-ui.js?v=20260918-blumr',
    'assets/feedback.js?v=20260916-learning',
    'assets/pdf-text.js?v=20260915-intake',
    'assets/resume-intake.js?v=20260923-learning',
    'assets/resume-remote.js?v=20260917-security',
    'assets/job-review.js?v=20260923-verification',
    'assets/candidate-automation.js?v=20260914-job-review',
    'assets/quick-notes.js?v=20260914-focus',
    'assets/candidate-workspace.js?v=20260922-resume-panel-v2',
    'assets/criteria-automation.js?v=20260924-priorities',
    'assets/home.js?v=20260918-blumr',
    'assets/focus-ui.js?v=20260918-blumr',
    'assets/recruiter-workflow.js?v=20260915-phase2',
    'assets/tutorial.js?v=20260915-tutorial',
    'assets/tutorial-ui.js?v=20260915-settings',
    'assets/admin-tools.js?v=20260917-security',
    'assets/settings.js?v=20260915-settings',
    'assets/settings-ui.js?v=20260918-blumr',
    'assets/guidance.js?v=20260916-polish',
    'assets/search-flow.js?v=20260918-home-panels',
    'assets/app.js?v=20260924-priorities'
  ];
  const parked = document.createDocumentFragment();
  let isParked = false;
  let loading = null;

  function parkWorkspace() {
    if (loading || isParked) return;
    const app = document.getElementById('rf-app');
    while (app.firstChild) parked.appendChild(app.firstChild);
    isParked = true;
  }

  function restoreWorkspace() {
    if (!isParked) return;
    document.getElementById('rf-app').appendChild(parked);
    isParked = false;
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.body.appendChild(script);
    });
  }

  function loadWorkspace() {
    if (loading) return loading;
    restoreWorkspace();
    window.dispatchEvent(new CustomEvent('blumr:workspace-loading'));
    loading = sources.reduce(function (chain, src) {
      return chain.then(function () { return loadScript(src); });
    }, Promise.resolve()).catch(function (error) {
      window.dispatchEvent(new CustomEvent('blumr:workspace-error'));
      throw error;
    });
    return loading;
  }

  window.addEventListener('ancalagon:auth-cleared', parkWorkspace);
  window.addEventListener('ancalagon:auth-ready', loadWorkspace);

  // Browser tests and local preview stubs can reveal the app without running auth.
  document.addEventListener('DOMContentLoaded', function () {
    const gate = document.getElementById('authGate');
    if (gate && gate.style.display === 'none') loadWorkspace();
  }, { once: true });
})();
