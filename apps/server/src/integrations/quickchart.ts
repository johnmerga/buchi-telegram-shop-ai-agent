import type { ChartConfig } from '../modules/reporting/reporting.domain';

/** QuickChart's free Community service. Its license is AGPL v3; see the design doc. */
const BASE_URL = 'https://quickchart.io';
const TIMEOUT_MS = 10_000;
const SIZE = { width: 800, height: 450 };

/** Renders a chart as a PNG image. QuickChart is the only implementation; tests use a fake. */
export interface ChartRenderer {
  render(chart: ChartConfig): Promise<Uint8Array>;
}

export class QuickChart implements ChartRenderer {
  constructor(private readonly fetch: typeof globalThis.fetch) {}

  async render(chart: ChartConfig): Promise<Uint8Array> {
    const response = await this.fetch(new URL('/chart', BASE_URL), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'image/png' },
      body: JSON.stringify({ chart, ...SIZE, format: 'png', backgroundColor: 'white' }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`QuickChart answered ${String(response.status)}`);
    if (response.headers.get('content-type') !== 'image/png') {
      throw new Error('QuickChart did not return a PNG image');
    }
    return new Uint8Array(await response.arrayBuffer());
  }
}
