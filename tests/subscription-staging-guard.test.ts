const assert = (value: unknown, message = 'Assertion failed') => { if (!value) throw new Error(message); };

Deno.test('billing staging guard blocks every non-staging request before transport', async () => {
  const previous = {url: Deno.env.get('SUPABASE_URL'), disabled: Deno.env.get('AI_PROVIDER_CALLS_DISABLED'), fetch: globalThis.fetch};
  const sent: string[] = [];
  try {
    Deno.env.set('SUPABASE_URL', 'https://momfzjmycveqginxmqib.supabase.co');
    Deno.env.set('AI_PROVIDER_CALLS_DISABLED', 'true');
    globalThis.fetch = (input, init) => { assert(init?.redirect === 'error', 'Redirect could escape the staging origin'); sent.push(String(input)); return Promise.resolve(new Response('synthetic')); };
    await import('../scripts/billing-staging-guard.ts?allowed');
    assert(Deno.env.get('AI_PROVIDER_CALLS_DISABLED') === 'true');
    for (const url of [
      'https://api.openai.com/v1/responses', 'https://api.anthropic.com/v1/messages',
      'https://zqiqjzxcpznhzjengfff.supabase.co/rest/v1/jobs',
      'http://momfzjmycveqginxmqib.supabase.co/rest/v1/jobs',
      'https://momfzjmycveqginxmqib.supabase.co.evil.test/',
      'https://user:password@momfzjmycveqginxmqib.supabase.co/',
      'https://momfzjmycveqginxmqib.supabase.co:8443/',
    ]) {
      let blocked = false;
      try { await fetch(url); } catch (error) { blocked = error instanceof Error && error.message === 'provider_calls_disabled'; }
      assert(blocked, 'Unexpected network permission: ' + url);
    }
    assert(sent.length === 0, 'A denied request reached transport');
    await fetch('https://momfzjmycveqginxmqib.supabase.co/rest/v1/jobs');
    assert(sent.length === 1, 'Own staging API was blocked');
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [name, value] of [['SUPABASE_URL', previous.url], ['AI_PROVIDER_CALLS_DISABLED', previous.disabled]]) {
      if (value === undefined) Deno.env.delete(name!); else Deno.env.set(name!, value);
    }
  }
});

Deno.test('billing staging guard refuses to initialize without the deployed provider lock', async () => {
  const previous = {url: Deno.env.get('SUPABASE_URL'), disabled: Deno.env.get('AI_PROVIDER_CALLS_DISABLED'), fetch: globalThis.fetch};
  try {
    Deno.env.set('SUPABASE_URL', 'https://momfzjmycveqginxmqib.supabase.co');
    Deno.env.delete('AI_PROVIDER_CALLS_DISABLED');
    let blocked = false;
    try { await import('../scripts/billing-staging-guard.ts?missing-lock'); }
    catch (error) { blocked = error instanceof Error && error.message === 'billing_staging_provider_lock_required'; }
    assert(blocked);
    assert(globalThis.fetch === previous.fetch, 'Transport changed before the lock was verified');
  } finally {
    for (const [name, value] of [['SUPABASE_URL', previous.url], ['AI_PROVIDER_CALLS_DISABLED', previous.disabled]]) {
      if (value === undefined) Deno.env.delete(name!); else Deno.env.set(name!, value);
    }
  }
});

Deno.test('billing staging guard refuses to initialize on production', async () => {
  const previous = Deno.env.get('SUPABASE_URL');
  const transport = globalThis.fetch;
  try {
    Deno.env.set('SUPABASE_URL', 'https://zqiqjzxcpznhzjengfff.supabase.co');
    let blocked = false;
    try { await import('../scripts/billing-staging-guard.ts?production'); }
    catch (error) { blocked = error instanceof Error && error.message === 'billing_staging_project_mismatch'; }
    assert(blocked);
    assert(globalThis.fetch === transport, 'Production transport was changed');
  } finally {
    if (previous === undefined) Deno.env.delete('SUPABASE_URL'); else Deno.env.set('SUPABASE_URL', previous);
  }
});
