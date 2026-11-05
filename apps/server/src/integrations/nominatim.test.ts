import { describe, expect, it } from 'vitest';
import ednaMall from './fixtures/nominatim-search-edna-mall.json';
import { Nominatim } from './nominatim';
import { urlOf } from '../../test/fakes/fetch';

const userAgent = 'Buchi/1.0 (test)';

function nominatimAnswering(...bodies: unknown[]) {
  const requests: { url: URL; headers: RequestInit['headers'] }[] = [];
  const waits: number[] = [];
  const clock = { time: 0 };
  const fetch: typeof globalThis.fetch = (input, init) => {
    requests.push({ url: new URL(urlOf(input)), headers: init?.headers });
    const body = bodies[Math.min(requests.length - 1, bodies.length - 1)];
    return Promise.resolve(body instanceof Response ? body : Response.json(body));
  };
  const nominatim = new Nominatim(userAgent, fetch, {
    now: () => new Date(clock.time),
    wait: (ms) => {
      waits.push(ms);
      clock.time += ms;
      return Promise.resolve();
    },
  });
  return { nominatim, requests, waits };
}

describe('Nominatim', () => {
  it('reads the first result of a recorded search', async () => {
    const { nominatim } = nominatimAnswering(ednaMall);
    await expect(nominatim.search('edna mall, bole')).resolves.toEqual({
      latitude: 8.9970566,
      longitude: 38.7866129,
    });
  });

  it('identifies Buchi and searches only inside Addis Ababa', async () => {
    const { nominatim, requests } = nominatimAnswering(ednaMall);
    await nominatim.search('edna mall, bole');
    const [request] = requests;
    expect(request?.headers).toMatchObject({ 'user-agent': userAgent });
    expect(Object.fromEntries(request?.url.searchParams ?? [])).toEqual({
      q: 'edna mall, bole',
      format: 'jsonv2',
      limit: '1',
      countrycodes: 'et',
      viewbox: '38.63,9.10,38.92,8.83',
      bounded: '1',
    });
  });

  it('answers a repeated search from the cache, including a search with no result', async () => {
    const { nominatim, requests } = nominatimAnswering(ednaMall, []);
    await nominatim.search('edna mall, bole');
    await nominatim.search('edna mall, bole');
    await expect(nominatim.search('nowhere, bole')).resolves.toBeUndefined();
    await expect(nominatim.search('nowhere, bole')).resolves.toBeUndefined();
    expect(requests).toHaveLength(2);
  });

  it('waits a second between requests', async () => {
    const { nominatim, waits } = nominatimAnswering(ednaMall);
    await Promise.all([nominatim.search('a'), nominatim.search('b'), nominatim.search('c')]);
    expect(waits).toEqual([1000, 1000]);
  });

  it('fails on an error answer and does not cache it', async () => {
    const { nominatim, requests } = nominatimAnswering(
      new Response('busy', { status: 503 }),
      ednaMall,
    );
    await expect(nominatim.search('edna mall, bole')).rejects.toThrow('Nominatim answered 503');
    await expect(nominatim.search('edna mall, bole')).resolves.toBeDefined();
    expect(requests).toHaveLength(2);
  });

  it('fails on an answer of an unexpected shape', async () => {
    const { nominatim } = nominatimAnswering({ error: 'Unable to geocode' });
    await expect(nominatim.search('edna mall, bole')).rejects.toThrow();
  });
});
