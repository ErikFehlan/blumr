// Public connectivity probe: normal TLS verification, no credentials or data writes.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

(async () => {
  const target = 'https://blumr.io/';
  await fs.mkdir('test-results/live', {recursive:true});
  let browser, page;
  const errors = [];
  try {
    browser = await chromium.launch({headless:true});
    page = await browser.newPage({viewport:{width:1440,height:1000}});
    page.on('pageerror', error => errors.push(error.message));
    const response = await page.goto(target, {waitUntil:'domcontentloaded',timeout:45000});
    assert.equal(response.status(), 200, 'Public homepage did not return HTTP 200');
    assert.equal(new URL(page.url()).origin, new URL(target).origin, 'Unexpected host redirect');
    await page.locator('body.rf-auth-guest').waitFor({timeout:30000});
    await page.getByRole('link',{name:'About',exact:true}).click();
    await page.waitForURL(url=>url.origin===new URL(target).origin&&/^\/about(?:\.html)?$/.test(url.pathname));
    await page.locator('#an-about-title').waitFor({state:'visible'});
    assert.equal(await page.locator('#rf-app, #authForm').count(),0,'About should be its own public page');
    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('#an-about-title').waitFor({state:'visible'});
    await page.getByRole('link',{name:'Back to home',exact:true}).click();
    await page.locator('body.rf-auth-guest').waitFor({timeout:30000});
    await page.locator('.an-header [data-auth-mode="signin"]').click();
    await page.locator('#authEmail').waitFor({state:'visible'});
    assert.ok(await page.locator('#authSubmit').isEnabled(), 'Sign-in control is disabled');
    assert.deepEqual(errors, [], 'Homepage JavaScript errors');
    await page.screenshot({path:'test-results/live/public-homepage.png'});
    await fs.writeFile('test-results/live/probe.json', JSON.stringify({url:target,status:'passed',checks:['HTTPS','homepage','About page and reload','application startup','sign-in form']},null,2));
    console.log('PASS: GitHub Chromium can open blumr.io over HTTPS and use the sign-in form.');
  } catch (error) {
    if(page) await page.screenshot({path:'test-results/live/public-failure.png'}).catch(()=>{});
    console.error('Public live-site probe failed:', error.message);
    process.exitCode = 1;
  } finally {
    if(browser) await browser.close();
  }
})();
