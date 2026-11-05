import { describe, expect, it } from 'vitest';
import { HttpRedirects } from './redirects';

function redirectsAnswering(response: Response) {
  const requests: RequestInit[] = [];
  const fetch: typeof globalThis.fetch = (_input, init) => {
    requests.push(init ?? {});
    return Promise.resolve(response);
  };
  return { redirects: new HttpRedirects(fetch), requests };
}

describe('HttpRedirects', () => {
  it('returns the Location header of a redirect without following it', async () => {
    const target = 'https://www.google.com/maps/place/Edna+Mall/@8.99,38.78,17z';
    const { redirects, requests } = redirectsAnswering(
      new Response(null, { status: 302, headers: { location: target } }),
    );
    await expect(redirects.target('https://maps.app.goo.gl/abc')).resolves.toBe(target);
    expect(requests[0]).toMatchObject({ method: 'HEAD', redirect: 'manual' });
  });

  it('resolves a relative Location against the link', async () => {
    const { redirects } = redirectsAnswering(
      new Response(null, { status: 301, headers: { location: '/maps/@9.01,38.76,15z' } }),
    );
    await expect(redirects.target('https://maps.app.goo.gl/abc')).resolves.toBe(
      'https://maps.app.goo.gl/maps/@9.01,38.76,15z',
    );
  });

  it('returns nothing for a link that does not redirect', async () => {
    const { redirects } = redirectsAnswering(new Response(null, { status: 404 }));
    await expect(redirects.target('https://maps.app.goo.gl/missing')).resolves.toBeUndefined();
  });
});
