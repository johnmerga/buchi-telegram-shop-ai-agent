import { describe, expect, it } from 'vitest';
import type { ChartConfig } from '../modules/insights/insights.domain';
import { urlOf } from '../../test/fakes/fetch';
import { QuickChart } from './quickchart';

const chart: ChartConfig = {
  type: 'bar',
  data: { labels: ['Nike Air'], datasets: [{ label: 'units', data: [7] }] },
  options: { plugins: { title: { display: true, text: 'Units' }, legend: { display: false } } },
};

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function clientAnswering(response: Response) {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    requests.push({ url: urlOf(input), init });
    return Promise.resolve(response);
  };
  return { client: new QuickChart(fetch), requests };
}

describe('QuickChart', () => {
  it('posts the chart config and returns the PNG bytes', async () => {
    const { client, requests } = clientAnswering(
      new Response(png, { headers: { 'content-type': 'image/png' } }),
    );
    await expect(client.render(chart)).resolves.toEqual(png);
    const [request] = requests;
    expect(request?.url).toBe('https://quickchart.io/chart');
    expect(request?.init?.method).toBe('POST');
    const body: unknown = JSON.parse(
      typeof request?.init?.body === 'string' ? request.init.body : '',
    );
    expect(body).toMatchObject({ chart, format: 'png', width: 800, height: 450 });
  });

  it('fails on an error status', async () => {
    const { client } = clientAnswering(new Response('rate limited', { status: 429 }));
    await expect(client.render(chart)).rejects.toThrow('QuickChart answered 429');
  });

  it('fails when the answer is not an image', async () => {
    const { client } = clientAnswering(Response.json({ error: 'bad chart' }));
    await expect(client.render(chart)).rejects.toThrow('did not return a PNG');
  });
});
