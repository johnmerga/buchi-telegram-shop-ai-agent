import type { Place } from '@buchi/shared';
import type { Logger } from 'pino';
import { AppError } from '../../shared/errors';

/** Finds places by name across Ethiopia. Nominatim is the only implementation. */
export interface PlaceFinder {
  searchPlaces(query: string): Promise<Place[]>;
}

/**
 * The map pickers' place search. A device far from its real place, such as Telegram Desktop with
 * an address-based location, needs a way to find the area other than panning the map.
 */
export class PlaceSearchService {
  constructor(
    private readonly finder: PlaceFinder,
    private readonly logger: Logger,
  ) {}

  async search(query: string): Promise<Place[]> {
    try {
      return await this.finder.searchPlaces(query);
    } catch (err) {
      this.logger.warn({ err }, 'place search unavailable');
      throw new AppError('UNAVAILABLE', 'Place search is not available right now. Try again.');
    }
  }
}
