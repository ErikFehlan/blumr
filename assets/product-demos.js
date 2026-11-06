/* These examples use only the fictional content already in the page. */
(() => {
  'use strict';
  const demo = document.querySelector('[data-product-demo]');
  if (!demo) return;

  const controls = [...demo.querySelectorAll('[data-demo-controls]')];
  const selectButton = (buttons, selected) => buttons.forEach(button => {
    button.setAttribute('aria-pressed', String(button === selected));
  });
  const showPanel = (panels, key, selected) => panels.forEach(panel => {
    panel.hidden = panel.dataset[key] !== selected;
  });

  if (demo.dataset.productDemo === 'candidate') {
    const versions = [...demo.querySelectorAll('[data-version]')];
    const resumes = [...demo.querySelectorAll('[data-resume]')];
    const edits = [...demo.querySelectorAll('[data-edit]')];
    const explanations = [...demo.querySelectorAll('[data-explanation]')];
    const highlights = demo.querySelector('[data-show-highlights]');
    const status = demo.querySelector('[data-version-status]');
    const selectVersion = button => {
      selectButton(versions, button);
      showPanel(resumes, 'resume', button.dataset.version);
      status.textContent = button.dataset.version === 'original' ? 'Original resume' : 'Proposed resume';
    };
    const selectEdit = button => {
      selectButton(edits, button);
      showPanel(explanations, 'explanation', button.dataset.edit);
      demo.querySelectorAll('[data-highlight]').forEach(item => {
        item.classList.toggle('is-selected', item.dataset.highlight.split(' ').includes(button.dataset.edit));
      });
    };
    versions.forEach(button => button.addEventListener('click', () => selectVersion(button)));
    edits.forEach(button => button.addEventListener('click', () => selectEdit(button)));
    highlights.addEventListener('change', () => {
      demo.dataset.highlights = String(highlights.checked);
    });
    selectEdit(edits.find(button => button.getAttribute('aria-pressed') === 'true'));
    selectVersion(versions.find(button => button.getAttribute('aria-pressed') === 'true'));
  }

  if (demo.dataset.productDemo === 'recruiter') {
    const stages = [...demo.querySelectorAll('[data-stage]')];
    const reports = [...demo.querySelectorAll('[data-report]')];
    const explanations = [...demo.querySelectorAll('[data-explanation]')];
    const notes = [...demo.querySelectorAll('[data-note]')];
    stages.forEach(button => button.addEventListener('click', () => {
      selectButton(stages, button);
      showPanel(reports, 'report', button.dataset.stage);
      showPanel(explanations, 'explanation', button.dataset.stage);
      showPanel(notes, 'note', button.dataset.stage);
    }));
  }

  // Keep the initial example readable if JavaScript is unavailable.
  controls.forEach(control => { control.hidden = false; });
})();
