import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../workers/resume-path.mjs';
test('canonical path keeps query parameters and rejects unrelated paths', async () => {
  const r = await handle(new Request('https://blumr.io/resume?guest=1'));
  assert.equal(r.headers.get('location'), 'https://blumr.io/resume/?guest=1');
  assert.equal((await handle(new Request('https://blumr.io/resumes'))).status, 404);
  assert.equal((await handle(new Request('https://other.example/resume/'))).status, 404);
});
test('fails closed without pilot identity and never proxies writes', async () => {
  assert.equal((await handle(new Request('https://blumr.io/resume/'))).status, 403);
  assert.equal((await handle(new Request('https://blumr.io/resume/', {method:'POST'}))).status, 405);
});
test('assets use candidate origin without recruiter cookies or authorization', async () => {
  const request = new Request('https://blumr.io/resume/vendor/regular.ttf', {headers:{'Cf-Access-Jwt-Assertion':'pilot-token',Cookie:'recruiter=secret',Authorization:'Bearer recruiter'}});
  const r = await handle(request, async req => {
    assert.equal(req.url, 'https://blumr-resume.pages.dev/vendor/regular.ttf');
    assert.equal(req.headers.get('Cookie'), 'CF_Authorization=pilot-token');
    assert.equal(req.headers.get('Authorization'), null);
    return new Response('font', {headers:{'set-cookie':'origin-cookie=x','content-type':'font/ttf'}});
  });
  assert.equal(await r.text(), 'font');
  assert.equal(r.headers.get('set-cookie'), null);
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
});
test('Pages canonical redirects stay under resume and external redirects fail closed', async () => {
  const req = new Request('https://blumr.io/resume/login.html', {headers:{'Cf-Access-Jwt-Assertion':'pilot-token'}});
  const r = await handle(req, async () => Response.redirect('https://blumr-resume.pages.dev/login', 301));
  assert.equal(r.headers.get('location'), 'https://blumr.io/resume/login');
  assert.equal((await handle(req, async () => Response.redirect('https://example.com/', 302))).status, 403);
});
