// Full-shell interaction checks with synthetic accounts. No production data or credentials.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { test, before, after } = require('node:test');
const defaults = require('../assets/settings.js').defaults;
const root = path.resolve(__dirname, '..');
let server, browser, url;

before(async () => {
  server = http.createServer((req, res) => {
    const pathname = req.url.split('?')[0];
    if (pathname !== '/' && !pathname.startsWith('/assets/')) {
      res.writeHead(404); res.end(); return;
    }
    const file = path.join(root, pathname === '/' ? 'index.html' : pathname);
    try {
      let content = fs.readFileSync(file);
      if (file.endsWith('index.html')) {
        // Keep the real auth.js lifecycle; only the external client is simulated.
        content = content.toString().replace(/<script[^>]+src="https:\/\/[^\"]+"[^>]*><\/script>/g, '');
      }
      res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'text/html');
      res.end(content);
    } catch { res.writeHead(404); res.end(); }
  }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  url = 'http://127.0.0.1:' + server.address().port + '/';
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await new Promise(resolve => server.close(resolve)); });

async function open(t, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**', route => route.abort());
  await page.route('**/assets/data.js*', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
  if (options.missing) await page.route('**/assets/' + options.missing + '.js*', route => route.abort());
  await page.addInitScript(({ defaults, options }) => {
    const copy = value => JSON.parse(JSON.stringify(value));
    const job = (id, title) => ({ id, title, description: 'Manual QA and release testing', criteria: ['Must Have | manual testing'], weights: [], knockouts: [], status: 'active', createdAt: 1, updatedAt: 1 });
    const candidate = (id, name) => ({ id, jobId: 'job-a', name, short: name, role: 'QA Analyst', stage: 'Sourced', resumeJDScore: 8, jdScore: 8, originalManagerScore: 8, managerScore: 8, rec: 'Consider', signal: 'Manual testing', strengths: ['Owned regression testing'], concerns: [], tags: [], screeningQuestions: [], createdAt: 1, updatedAt: 1 });
    const state = { jobs: options.empty ? [] : [job('job-a', 'Synthetic QA'), job('job-b', 'Synthetic second search')], candidates: options.empty ? [] : [candidate('candidate-a', 'Alex Example'), candidate('candidate-b', 'Jamie Example')], feedback: [], interviewOutcomes: [] };
    const session = { access_token: 'synthetic-token', user: { id: 'synthetic-user', email: 'qa@example.test', user_metadata: {} } };
    window.auditLoads = 0;
    window.auditFailLoad = Boolean(options.failLoad);
    window.auditSaved = copy(state);
    window.supabase = { createClient: () => ({
      auth: {
        getSession: async () => ({ data: { session: options.guest ? null : session }, error: null }),
        onAuthStateChange: callback => { window.auditAuthCallback = callback; return { data: { subscription: { unsubscribe() {} } } }; },
        signInWithPassword: async () => { if (window.auditAuthThrows) throw Error('Synthetic connection failure'); return { error: { code: 'invalid_credentials', message: 'Invalid login credentials' } }; },
        signUp: async () => { if (window.auditAuthThrows) throw Error('Synthetic connection failure'); return { data: { session: null }, error: null }; },
        resetPasswordForEmail: async () => { if (window.auditAuthThrows) throw Error('Synthetic connection failure'); return { error: null }; },
        signOut: async () => { if (window.auditAuthThrows) throw Error('Synthetic connection failure'); return { error: null }; }
      },
      from: () => ({ select: () => ({ limit: () => ({ maybeSingle: async () => ({ data: { workspace_id: 'synthetic-workspace', role: 'owner', workspaces: { name: 'Synthetic workspace' } }, error: null }) }) }) })
    }) };
    window.AncalagonData = { create: () => ({
      load: async () => { window.auditLoads++; if (window.auditFailLoad) throw Error('Synthetic workspace failure'); return copy(state); },
      loadSettings: async () => ({ ...defaults }), saveSettings: async settings => settings,
      loadHome: async () => null, visitHome: async () => {}, saveHome: async () => {}, loadHomeReviews: async () => [],
      loadTutorial: async () => ({ state: null, revision: 0 }), saveTutorial: async (_, revision) => ({ revision: revision + 1 }),
      loadGuidance: async () => ({ enabled: false, tips: {} }), saveGuidance: async () => ({ enabled: false, tips: {} }),
      loadJobReassessments: async () => [], loadCriteriaTask: async () => null,
      loadNotifications: async () => [], markNotificationsRead: async () => {}, loadSupportRequests: async () => [],
      loadPersonalUsage: async () => ({ jobs: state.jobs.length, candidates: state.candidates.length }),
      loadAdminAnalytics: async () => { throw Error('Not an administrator'); }, isAppAdmin: async () => false,
      trackEvent: async () => {}, schedule: (value, _, status) => { window.auditSaved = copy(value); status('saved'); },
      flush: async value => { window.auditSaved = copy(value); }
    }) };
  }, { defaults, options });
  await page.goto(url);
  if (!options.missing && !options.guest) {
    await page.locator('body.rf-authenticated:not(.rf-data-loading)').waitFor();
    await page.locator('#page-home.active').waitFor();
  }
  return { page, errors };
}

async function navigate(page, name, keyboard = false) {
  const mobile = page.locator('#mobileNavToggle');
  if (await mobile.isVisible() && !(await page.locator('.rf-sidebar').evaluate(el => el.classList.contains('open')))) await mobile.click();
  const button = page.locator('.rf-nav [data-page="' + name + '"]');
  const group = await button.evaluate(el => el.closest('details')?.id || null);
  if (group && !(await page.locator('#' + group).evaluate(el => el.open))) await page.locator('#' + group + ' > summary').click();
  if (keyboard) { await button.focus(); await button.press('Enter'); } else await button.click();
}

test('every workspace tab responds across all ten themes; dropdowns, exports, keyboard and mobile navigation work', async t => {
  const { page, errors } = await open(t);
  const pages = ['home', 'jobs', 'dashboard', 'candidates', 'pipeline', 'feedback', 'outcomes', 'criteria', 'rankings', 'compare', 'benchmarks', 'insights', 'learn'];
  const themes = ['tech', 'violet', 'emerald', 'graphite', 'ocean', 'ember', 'rose', 'light', 'paper', 'sage'];
  for (const theme of themes) {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.locator('[data-theme-choice="' + theme + '"]').click();
    assert.equal(await page.locator('#rf-app').getAttribute('data-theme'), theme);
    for (const name of pages) {
      await navigate(page, name);
      assert.equal(await page.locator('#page-' + name).isVisible(), true, theme + ': ' + name);
    }
  }
  await navigate(page, 'candidates');
  await page.locator('#candidateSort').locator('..').locator('.rf-select-button').click();
  await page.locator('#candidateSort').locator('..').locator('.rf-select-menu').getByRole('option', { name: 'Name A–Z', exact: true }).click();
  assert.equal(await page.locator('#candidateSort').inputValue(), 'name');
  await page.locator('[data-candidate-id="candidate-a"]').first().click();
  await page.locator('#page-detail.active').waitFor();
  await page.locator('#backCandidates').click();
  await page.locator('#page-candidates.active').waitFor();
  await navigate(page, 'compare');
  assert.equal(await page.locator('#runCompare').isDisabled(), true, 'comparison requires two selections');
  for (const [id, label] of [['compare1', 'Alex Example'], ['compare2', 'Jamie Example']]) {
    const wrapper = page.locator('#' + id).locator('..');
    await wrapper.locator('.rf-select-button').click();
    await wrapper.locator('.rf-select-menu').getByRole('option', { name: new RegExp('^' + label + ' ·') }).click();
  }
  await page.locator('#runCompare').click();
  assert.match(await page.locator('#compareResults').textContent(), /Alex Example/);
  assert.match(await page.locator('#compareResults').textContent(), /Jamie Example/);
  await navigate(page, 'rankings');
  const csv = page.waitForEvent('download'); await page.locator('#rankExportBtn').click();
  assert.equal((await csv).suggestedFilename(), 'blumr-rankings.csv');
  await navigate(page, 'dashboard');
  const report = page.waitForEvent('download'); await page.locator('#exportBtn').click();
  assert.equal((await report).suggestedFilename(), 'blumr-report.txt');
  await navigate(page, 'jobs', true);
  assert.equal(await page.locator('#page-jobs').isVisible(), true);
  await page.locator('#newJobBtn').click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'jobTitle');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const name of ['home', 'jobs', 'candidates', 'pipeline', 'feedback', 'learn']) {
      await navigate(page, name);
      assert.equal(await page.locator('#page-' + name).isVisible(), true, width + ': ' + name);
      assert.equal(await page.locator('.rf-sidebar').evaluate(el => el.classList.contains('open')), false);
    }
  }
  assert.deepEqual(errors, []);
});

test('new accounts get an actionable explanation from every job-specific tab', async t => {
  const { page, errors } = await open(t, { empty: true });
  for (const name of ['dashboard', 'candidates', 'pipeline', 'feedback', 'outcomes', 'criteria', 'rankings', 'compare', 'benchmarks', 'insights']) {
    await navigate(page, 'home');
    await navigate(page, name);
    assert.equal(await page.locator('#page-jobs').isVisible(), true, name + ' should lead to job setup');
    assert.match(await page.locator('#toastRegion').textContent(), /Create a job/);
    assert.equal(await page.locator('#jobEditor').evaluate(el => el.open), true);
  }
  assert.deepEqual(errors, []);
});

test('Retry reloads failed workspace data without creating unsaved jobs', async t => {
  const { page, errors } = await open(t, { failLoad: true });
  assert.equal(await page.locator('#syncStatus').getAttribute('data-state'), 'error');
  await navigate(page, 'jobs');
  assert.equal(await page.locator('#page-home').isVisible(), true, 'failed load must not allow unsaved job creation');
  await page.evaluate(() => { window.auditFailLoad = false; });
  await page.locator('#retrySync').click();
  await page.waitForFunction(() => window.auditLoads === 2 && document.querySelector('#syncStatus').dataset.state === 'saved');
  await navigate(page, 'jobs');
  assert.match(await page.locator('#jobList').textContent(), /Synthetic QA/);
  assert.deepEqual(errors, []);
});

test('missing application scripts show a recovery control instead of an unresponsive shell', async t => {
  const { page } = await open(t, { missing: 'app' });
  await page.locator('#startupProblem').waitFor({ state: 'visible' });
  assert.match(await page.locator('#startupProblem').textContent(), /could not finish loading/i);
  assert.equal(await page.locator('#startupReload').isEnabled(), true);
  await page.unroute('**/assets/app.js*');
  await page.locator('#startupReload').click();
  await page.locator('body.rf-authenticated:not(.rf-data-loading)').waitFor();
  await page.locator('#page-home.active').waitFor();
  assert.equal(await page.locator('#startupProblem').isVisible(), false);
  await navigate(page, 'jobs');
  assert.equal(await page.locator('#page-jobs').isVisible(), true);
});

test('interrupted sign-in, signup and recovery restore their buttons and explain the problem', async t => {
  const { page, errors } = await open(t, { guest: true });
  await page.getByRole('link', { name: 'Log in', exact: true }).first().click();
  await page.locator('#authEmail').fill('synthetic@example.test');
  await page.locator('#authPassword').fill('Synthetic-password-only');
  await page.evaluate(() => { window.auditAuthThrows = true; });
  await page.locator('#authSubmit').click();
  await page.waitForFunction(() => !document.getElementById('authSubmit').disabled);
  assert.match(await page.locator('#authMessage').textContent(), /connection|try again/i);
  await page.evaluate(() => { window.auditAuthThrows = false; });
  await page.locator('#authSubmit').click();
  await page.waitForFunction(() => document.getElementById('authMessage').textContent.includes('incorrect'));
  await page.evaluate(() => { window.auditAuthThrows = true; });
  await page.locator('#forgotAccess').click();
  await page.locator('#recoverySubmit').click();
  await page.waitForFunction(() => !document.getElementById('recoverySubmit').disabled);
  assert.match(await page.locator('#recoveryMessage').textContent(), /connection|try again/i);
  await page.locator('#recoveryCancel').click();
  await page.locator('#createAccountTab').click();
  await page.locator('#authName').fill('Synthetic Recruiter');
  await page.locator('#authEmail').fill('synthetic@example.test');
  await page.locator('#authPassword').fill('Synthetic-password-only');
  await page.locator('#authConfirmPassword').fill('Synthetic-password-only');
  await page.locator('#authSubmit').click();
  await page.waitForFunction(() => !document.getElementById('authSubmit').disabled);
  assert.match(await page.locator('#authMessage').textContent(), /connection|try again/i);
  assert.deepEqual(errors, []);
});

test('interrupted sign-out keeps the workspace usable and lets the user retry', async t => {
  const { page, errors } = await open(t);
  await page.evaluate(() => { window.auditAuthThrows = true; });
  await page.locator('#authSignOut').click();
  await page.waitForFunction(() => !document.getElementById('authSignOut').disabled);
  assert.match(await page.locator('#toastRegion').textContent(), /connection|try again/i);
  await navigate(page, 'jobs');
  assert.equal(await page.locator('#page-jobs').isVisible(), true);
  assert.deepEqual(errors, []);
});
