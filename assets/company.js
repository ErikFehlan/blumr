/* Navigation disclosures and the existing recruiter sign-in surface. */
(() => {
  'use strict';
  const header = document.querySelector('.bm-header');
  if (!header) return;
  const disclosures = [...header.querySelectorAll('details')];
  const mobile = header.querySelector('.bm-mobile-toggle');
  const closeMenus = except => disclosures.forEach(menu => { if (menu !== except) menu.open = false; });
  disclosures.forEach(menu => {
    menu.addEventListener('toggle', () => {
      menu.querySelector('summary').setAttribute('aria-expanded', String(menu.open));
      if (menu.open) closeMenus(menu);
    });
  });
  mobile.addEventListener('click', () => {
    const open = !header.hasAttribute('data-mobile-open');
    header.toggleAttribute('data-mobile-open', open);
    mobile.setAttribute('aria-expanded', String(open));
    mobile.textContent = open ? 'Close' : 'Menu';
    if (!open) closeMenus();
  });
  document.addEventListener('click', event => {
    disclosures.forEach(menu => { if (!menu.contains(event.target)) menu.open = false; });
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const open = disclosures.find(menu => menu.open);
    if (open) { open.open = false; open.querySelector('summary').focus(); }
    else if (header.hasAttribute('data-mobile-open')) { mobile.click(); mobile.focus(); }
  });
  header.addEventListener('focusout', () => {
    requestAnimationFrame(() => { if (!header.contains(document.activeElement)) closeMenus(); });
  });
  const gate = document.getElementById('authGate');
  if (!document.getElementById('authForm')) return;
  function syncAuthSurface() {
    const open = location.hash === '#authAccess' || new URLSearchParams(location.search).has('auth');
    gate.classList.toggle('bm-auth-open', open);
  }
  // Capture before auth.js focuses the existing form. No auth logic is replaced.
  document.addEventListener('click', event => {
    const link = event.target.closest('[data-auth-mode]');
    if (!link) return;
    history.pushState(null, '', link.dataset.authMode === 'create' ? '?auth=create#authAccess' : '?auth=signin#authAccess');
    syncAuthSurface();
    closeMenus();
  }, true);
  addEventListener('hashchange', syncAuthSurface);
  addEventListener('popstate', syncAuthSurface);
  // showGuest emits this before removing the previous workspace state. A
  // signed-out or expired session should reveal sign-in, even on a clean URL.
  addEventListener('ancalagon:auth-cleared', () => {
    if (!document.body.matches('.rf-authenticated, .rf-data-loading')) return;
    const url = new URL(location.href);
    url.hash = 'authAccess';
    history.replaceState(null, '', url);
    syncAuthSurface();
  });
  syncAuthSurface();
})();
