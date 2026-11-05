// Public candidate frontend. Saved data stays behind candidate Supabase Auth.
// Never forward recruiter cookies or authorization to the static Pages origin.
const ORIGIN = 'https://blumr-resume.pages.dev';
export async function handle(request, fetcher = fetch) {
  const url = new URL(request.url);
  if (url.hostname !== 'blumr.io' || !(url.pathname === '/resume' || url.pathname.startsWith('/resume/')))
    return new Response('Not found', { status: 404 });
  if (!['GET', 'HEAD'].includes(request.method))
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  if (url.pathname === '/resume') {
    url.pathname = '/resume/';
    return Response.redirect(url, 308);
  }
  const target = new URL(ORIGIN);
  target.pathname = url.pathname.slice('/resume'.length);
  target.search = url.search;
  const headers = new Headers();
  for (const name of ['accept', 'accept-encoding', 'range', 'if-none-match']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const upstream = await fetcher(new Request(target, { method: request.method, headers, redirect: 'manual' }));
  const result = new Response(upstream.body, upstream);
  result.headers.delete('set-cookie');
  result.headers.set('Cache-Control', 'no-store');
  const location = result.headers.get('location');
  if (location) {
    const redirect = new URL(location, target);
    if (redirect.origin !== ORIGIN)
      return new Response('The resume tool could not load. Please try again.', { status: 403 });
    redirect.hostname = url.hostname;
    redirect.pathname = '/resume' + redirect.pathname;
    result.headers.set('location', redirect.href);
  }
  return result;
}
export default { fetch: request => handle(request) };
