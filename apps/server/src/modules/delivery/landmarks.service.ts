import type { Logger } from 'pino';
import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import { normalizeLandmark, type LandmarkName } from './landmarks.domain';
import type { LandmarksRepo } from './landmarks.repo';
import type { Coordinates } from './location.domain';

/** Finds places by name. Nominatim is the only implementation. */
export interface Geocoder {
  search(query: string): Promise<Coordinates | undefined>;
}

export type LandmarkMatch =
  | { source: 'memory'; coordinates: Coordinates; confirmations: number }
  | { source: 'nominatim'; coordinates: Coordinates };

/**
 * The shop's memory of landmarks its customers name. The sales agent extracts the landmark and the
 * area (Task 4.1), and the map picker opens on the match for the customer to confirm.
 */
export class LandmarkService {
  constructor(
    private readonly db: Database,
    private readonly repo: LandmarksRepo,
    private readonly geocoder: Geocoder,
    private readonly logger: Logger,
  ) {}

  /** Looks in the shop's memory first, then asks Nominatim. */
  async find(shopId: string, landmark: LandmarkName): Promise<LandmarkMatch | undefined> {
    const key = normalizeLandmark(landmark);
    const remembered = await withShop(this.db, shopId, (tx) => this.repo.find(tx, key));
    if (remembered) {
      const { latitude, longitude, confirmations } = remembered;
      return { source: 'memory', coordinates: { latitude, longitude }, confirmations };
    }
    const found = await this.search(`${key.name}, ${key.area}`);
    return found && { source: 'nominatim', coordinates: found };
  }

  /** Remembers the pin a customer confirmed for a landmark. */
  async confirm(shopId: string, landmark: LandmarkName, coordinates: Coordinates): Promise<void> {
    await withShop(this.db, shopId, (tx) =>
      this.repo.confirm(tx, shopId, normalizeLandmark(landmark), coordinates),
    );
  }

  /** Without Nominatim the map picker opens without a suggested pin, so a failure is not fatal. */
  private async search(query: string): Promise<Coordinates | undefined> {
    try {
      return await this.geocoder.search(query);
    } catch (err) {
      this.logger.warn({ err }, 'landmark search unavailable');
      return undefined;
    }
  }
}
