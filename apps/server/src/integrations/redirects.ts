import type { RedirectReader } from '../modules/delivery/location.service';

const TIMEOUT_MS = 5000;

/** Reads a redirect's target with a HEAD request, so the page itself never loads. */
export class HttpRedirects implements RedirectReader {
  constructor(private readonly fetch: typeof globalThis.fetch) {}

  async target(url: string): Promise<string | undefined> {
    const response = await this.fetch(url, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const location = response.headers.get('location');
    const redirected = response.status >= 300 && response.status < 400 && location !== null;
    return redirected ? new URL(location, url).toString() : undefined;
  }
}
