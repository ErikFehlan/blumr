const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

(async () => {
  const server = http.createServer(async (req, res) => {
    try {
      const file = path.join(root, new URL(req.url, 'http://localhost').pathname);
      res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'text/html');
      res.end(await fs.readFile(file));
    } catch { res.writeHead(404); res.end(); }
  }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  let browser;
  try {
    browser = await chromium.launch({headless:true, executablePath:process.env.TEST_CHROME});
    const page = await browser.newPage({viewport:{width:1440,height:900}});
    const errors = [], backendRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const request = new URL(route.request().url());
      if (/supabase|openai/.test(request.hostname)) backendRequests.push(request.hostname);
      return request.hostname === '127.0.0.1' ? route.continue() : route.abort();
    });
    await page.goto(url + 'candidates.html');
    await page.getByRole('link', {name:'Try the interactive example →',exact:true}).click();
    await page.waitForURL('**/candidate-tailoring.html');
    await page.locator('[data-version="original"]').waitFor({state:'visible'});
    const original = page.locator('#resume-original'), tailored = page.locator('#resume-tailored');
    const originalText = await original.textContent(), tailoredText = await tailored.textContent();
    assert.equal(await tailored.isVisible(), true);
    assert.equal(await original.isVisible(), false);
    assert.match(await tailored.locator('li').first().textContent(), /C#\/\.NET APIs/);
    assert.match(await original.locator('li').first().textContent(), /React/);
    assert.doesNotMatch(tailoredText, /Kubernetes/);
    assert.match(await page.locator('.bd-disclaimer').allTextContents().then(x=>x.join(' ')), /Fictional/);
    await page.locator('[data-version="original"]').press('Enter');
    assert.equal(await original.isVisible(), true);
    assert.equal(await tailored.isVisible(), false);
    assert.equal(await page.locator('[data-version="original"]').getAttribute('aria-pressed'), 'true');
    await page.locator('[data-edit="wording"]').press('Space');
    assert.match(await page.locator('#candidate-explanation').innerText(), /Neither edit adds tools or achievements/);
    assert.equal(await original.locator('.is-selected').count(), 2);
    await page.getByLabel('Highlight selected edit', {exact:true}).uncheck();
    assert.equal(await page.locator('[data-product-demo]').getAttribute('data-highlights'), 'false');
    await page.locator('[data-version="tailored"]').click();
    assert.equal(await tailored.isVisible(), true);
    await page.locator('[data-edit="grounding"]').click();
    assert.match(await page.locator('#candidate-explanation').innerText(), /stays out unless/);
    assert.equal(await tailored.textContent(), tailoredText, 'Exploring an edit must not invent or alter sample experience');
    assert.equal(await original.textContent(), originalText);
    await page.getByLabel('Highlight selected edit', {exact:true}).check();
    assert.equal(await page.locator('.bd-gap.is-selected').count(), 1);
    assert.equal(await page.getByRole('link', {name:'Build your resume →',exact:true}).getAttribute('href'), '/resume/?guest=1');
    assert.equal(await page.evaluate(()=>localStorage.length), 0, 'The example should not save visitor data');

    await page.goto(url + 'recruiters.html');
    await page.getByRole('link', {name:'Try the interactive example →',exact:true}).click();
    await page.waitForURL('**/recruiter-feedback.html');
    await page.locator('[data-stage="resume"]').waitFor({state:'visible'});
    const report = page.locator('#recruiter-report');
    const source = await page.locator('[data-report="resume"] blockquote').textContent();
    await page.locator('[data-stage="priority"]').press('Enter');
    assert.match(await report.innerText(), /Strategy ownership needs evidence/);
    assert.equal(await page.locator('[data-report="priority"] blockquote').textContent(), source);
    assert.match(await report.innerText(), /How did you prioritize coverage/);
    await page.locator('[data-stage="notes"]').press('Space');
    assert.match(await report.innerText(), /Ownership supported by screening notes/);
    assert.match(await report.innerText(), /Source: recruiter’s screening note/i);
    assert.match(await report.innerText(), /What to confirm next/);
    await page.locator('[data-stage="resume"]').click();
    assert.match(await report.innerText(), /Automation experience supported/);
    assert.doesNotMatch(await report.innerText(), /Taylor defined coverage/);
    assert.equal(await page.locator('[data-stage][aria-pressed="true"]').count(), 1);

    for (const width of [820,390,320]) {
      await page.setViewportSize({width,height:844});
      for (const file of ['candidate-tailoring.html','recruiter-feedback.html']) {
        await page.goto(url + file);
        await page.locator('[data-demo-controls]').first().waitFor({state:'visible'});
        const buttons = file.startsWith('candidate') ? page.locator('[data-edit], [data-version]') : page.locator('[data-stage]');
        for (const button of await buttons.all()) {
          await button.click();
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth), true, file + ' overflow at ' + width);
        }
      }
    }
    const fallback = await browser.newPage({javaScriptEnabled:false});
    for (const file of ['candidate-tailoring.html','recruiter-feedback.html']) {
      await fallback.goto(url + file);
      assert.equal(await fallback.locator('[data-demo-controls]:visible').count(), 0);
      assert.equal(await fallback.locator('.bm-example').isVisible(), true);
      assert.equal(await fallback.locator('.bd-heading .bm-button').isVisible(), true);
    }
    await fallback.close();
    assert.deepEqual(errors, []);
    assert.deepEqual(backendRequests, [], 'Public examples must not call AI or production data services');
    await fs.mkdir(path.join(root, 'test-results'), {recursive:true});
    await page.setViewportSize({width:1440,height:900});
    await page.goto(url + 'candidate-tailoring.html');
    await page.screenshot({path:path.join(root,'test-results/landing-candidate-example.png'),fullPage:true});
    await page.goto(url + 'recruiter-feedback.html');
    await page.locator('[data-stage="notes"]').click();
    await page.screenshot({path:path.join(root,'test-results/landing-recruiter-example.png'),fullPage:true});
    console.log('PASS: public candidate and recruiter examples, keyboard controls, evidence preservation, mobile layouts, and no-JavaScript fallback.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
