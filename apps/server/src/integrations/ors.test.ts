import { describe, expect, it } from 'vitest';
import directions from './fixtures/ors-directions.json';
import matrix from './fixtures/ors-matrix.json';
import samePoint from './fixtures/ors-directions-same-point.json';
import unroutable from './fixtures/ors-error-unroutable.json';
import { OpenRouteService } from './ors';
import { urlOf } from '../../test/fakes/fetch';

const shop = { latitude: 9.0108, longitude: 38.7613 };
const ednaMall = { latitude: 8.9970566, longitude: 38.7866129 };

function clientAnswering(body: unknown, status = 200) {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    requests.push({ url: urlOf(input), init });
    return Promise.resolve(Response.json(body, { status }));
  };
  const client = new OpenRouteService(
    { baseUrl: 'https://api.heigit.org', apiKey: 'key-1' },
    fetch,
  );
  return { client, requests };
}

describe('OpenRouteService', () => {
  it('reads the road distance and duration, rounded to whole meters and seconds', async () => {
    const { client } = clientAnswering(directions);
    await expect(client.route(shop, ednaMall)).resolves.toEqual({ meters: 4874, seconds: 702 });
  });

  it('posts longitude-first coordinates to the HeiGIT directions path with the raw key', async () => {
    const { client, requests } = clientAnswering(directions);
    await client.route(shop, ednaMall);
    const [request] = requests;
    expect(request?.url).toBe('https://api.heigit.org/openrouteservice/v2/directions/driving-car');
    expect(request?.init?.method).toBe('POST');
    expect(request?.init?.headers).toMatchObject({ authorization: 'key-1' });
    expect(JSON.parse(typeof request?.init?.body === 'string' ? request.init.body : '')).toEqual({
      coordinates: [
        [38.7613, 9.0108],
        [38.7866129, 8.9970566],
      ],
      instructions: false,
      geometry: false,
    });
  });

  it('reads a summary without distance and duration as zero', async () => {
    const { client } = clientAnswering(samePoint);
    await expect(client.route(shop, shop)).resolves.toEqual({ meters: 0, seconds: 0 });
  });

  it('fails on an error answer', async () => {
    const { client } = clientAnswering(unroutable, 404);
    await expect(client.route(shop, ednaMall)).rejects.toThrow('OpenRouteService answered 404');
  });

  it('fails on an answer of an unexpected shape', async () => {
    const { client } = clientAnswering({ routes: [{ summary: { distance: 'far' } }] });
    await expect(client.route(shop, ednaMall)).rejects.toThrow();
  });

  it('fails when there is no route', async () => {
    const { client } = clientAnswering({ routes: [] });
    await expect(client.route(shop, ednaMall)).rejects.toThrow('no route');
  });
});

describe('OpenRouteService matrix', () => {
  it('reads distances and durations, rounded to whole meters and seconds', async () => {
    const { client } = clientAnswering(matrix);
    await expect(client.matrix([shop, ednaMall])).resolves.toEqual({
      meters: [
        [0, 4874],
        [4901, 0],
      ],
      seconds: [
        [0, 702],
        [716, 0],
      ],
    });
  });

  it('posts longitude-first locations to the matrix path', async () => {
    const { client, requests } = clientAnswering(matrix);
    await client.matrix([shop, ednaMall]);
    const [request] = requests;
    expect(request?.url).toBe('https://api.heigit.org/openrouteservice/v2/matrix/driving-car');
    expect(JSON.parse(typeof request?.init?.body === 'string' ? request.init.body : '')).toEqual({
      locations: [
        [38.7613, 9.0108],
        [38.7866129, 8.9970566],
      ],
      metrics: ['distance', 'duration'],
    });
  });

  it('fails when a point cannot be reached by road', async () => {
    const { client } = clientAnswering({
      ...matrix,
      durations: [
        [0, null],
        [null, 0],
      ],
    });
    await expect(client.matrix([shop, ednaMall])).rejects.toThrow();
  });

  it('fails on a matrix of the wrong size', async () => {
    const { client } = clientAnswering({ distances: [[0]], durations: [[0]] });
    await expect(client.matrix([shop, ednaMall])).rejects.toThrow('wrong size');
  });
});
