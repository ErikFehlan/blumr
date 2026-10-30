(function () {
  'use strict';

  const sources = [
    'assets/job-intake-code.js?v=20261002-guided-experience',
    'assets/job-wizard.js?v=20261016-priorities',
    'assets/hiring-priorities.js?v=20261016-priorities',
    'assets/data.js?v=20261028-billing',
    'assets/select.js?v=20260910-dark-dropdowns',
    'assets/presentation.js?v=20261014-decisions',
    'assets/evidence.js?v=20260911-quick-feedback',
    'assets/context.js?v=20261006-role-neutral',
    'assets/assessment-memory.js?v=20261014-feedback',
    'assets/scoring.js?v=20260911-quick-feedback',
    'assets/quality.js?v=20260915-core',
    'assets/quality-ui.js?v=20260918-blumr',
    'assets/feedback.js?v=20261028-subscriptions',
    'assets/idempotency.js?v=20260930-idempotency',
    'assets/upload-validation.js?v=20261005-upload-guards',
    'assets/resume-word-text.js?v=20261030-isolated-word',
    'assets/pdf-text.js?v=20260915-intake',
    'assets/resume-viewer.js?v=20261014-repeat-resume',
    'assets/experience.js?v=20261015-experience',
    'assets/resume-intake.js?v=20261027-unified-resumes',
    'assets/resume-remote.js?v=20261020-bulk-reload',
    'assets/feedback-impact.js?v=20261015-shortlist',
    'assets/job-review.js?v=20261028-reporting',
    'assets/candidate-automation.js?v=20260914-job-review',
    'assets/quick-notes.js?v=20260914-focus',
    'assets/candidate-workspace.js?v=20261027-submittal-save',
    'assets/criteria-automation.js?v=20261002-guided-experience',
    'assets/decision-workspace.js?v=20261027-unified-resumes',
    'assets/home.js?v=20261015-experience',
    'assets/focus-ui.js?v=20261014-decisions',
    'assets/recruiter-workflow.js?v=20261027-unified-resumes',
    'assets/tutorial.js?v=20260915-tutorial',
    'assets/tutorial-ui.js?v=20260915-settings',
    'assets/subscription-admin.js?v=20261028-admin',
    'assets/admin-tools.js?v=20261028-reporting',
    'assets/subscriptions.js?v=20261028',
    'assets/subscription-billing.js?v=20261028-billing',
    'assets/subscription-ui.js?v=20261028-billing',
    'assets/settings.js?v=20261014-feedback',
    'assets/settings-ui.js?v=20261028-reporting',
    'assets/guidance.js?v=20260916-polish',
    'assets/search-flow.js?v=20261028-reporting',
    'assets/retention-analytics.js?v=20261014-retention',
    'assets/vendor/jszip-3.10.1.min.js',
    'assets/bulk-files.js?v=20261020-bulk',
    'assets/candidate-list.js?v=20261027-all-candidates',
    'assets/bulk-screening.js?v=20261028-reporting',
    'assets/screening-report.js?v=20261028-reporting',
    'assets/app.js?v=20261030-isolated-word'
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
