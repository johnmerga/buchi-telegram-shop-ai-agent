import type { Logger } from 'pino';
import { readLocationText, type PinResult } from './location.domain';

/** Reads where a link redirects to, without loading the page. */
export interface RedirectReader {
  target(url: string): Promise<string | undefined>;
}

/** Google's short links redirect once. A few more hops allow for a changed link format. */
const MAX_REDIRECTS = 3;

const askForPin: PinResult = { status: 'ask_for_pin', reason: 'no_coordinates' };

/** Turns a customer's text into a delivery pin, following short Google Maps links. */
export class LocationService {
  constructor(
    private readonly redirects: RedirectReader,
    private readonly logger: Logger,
  ) {}

  async fromText(text: string): Promise<PinResult | { status: 'not_a_location' }> {
    let read = readLocationText(text);
    for (let hops = 0; read.status === 'short_link'; hops += 1) {
      if (hops === MAX_REDIRECTS) return askForPin;
      const target = await this.redirectTarget(read.url);
      if (target === undefined) return askForPin;
      read = readLocationText(target);
      // A short link that leads anywhere but a map has no pin to read.
      if (read.status === 'not_a_location') return askForPin;
    }
    return read;
  }

  private async redirectTarget(url: string): Promise<string | undefined> {
    try {
      return await this.redirects.target(url);
    } catch (err) {
      this.logger.warn({ err }, 'could not read a short map link');
      return undefined;
    }
  }
}
