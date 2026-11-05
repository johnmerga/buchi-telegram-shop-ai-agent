import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import type { AreaNoteRow, AreaNotesRepo } from './area-notes.repo';
import { nearbyZones } from './zones.domain';

/** Road reports older than this describe roads that have probably changed. */
const NOTE_WINDOW_MS = 7 * 24 * 60 * 60_000;
const MAX_NOTES = 5;

/** A report about an area to keep, such as a driver's note about a closed road. */
export interface NewAreaNote {
  /** The H3 resolution-7 zone the note is about. */
  zone: string;
  note: string;
  synthetic: boolean;
  /** When it was reported, for seeded notes. New reports take the current time. */
  createdAt?: Date;
}

/** Recent reports about areas, which the operations agent reads as evidence for far prices. */
export class AreaNotesService {
  constructor(
    private readonly db: Database,
    private readonly repo: AreaNotesRepo,
    private readonly now: () => Date,
  ) {}

  async add(shopId: string, note: NewAreaNote): Promise<void> {
    await withShop(this.db, shopId, (tx) => this.repo.insert(tx, { shopId, ...note }));
  }

  /** The latest notes from the last week about the zone and the zones around it. */
  recent(shopId: string, zone: string): Promise<AreaNoteRow[]> {
    const since = new Date(this.now().getTime() - NOTE_WINDOW_MS);
    return withShop(this.db, shopId, (tx) =>
      this.repo.recent(tx, nearbyZones(zone), since, MAX_NOTES),
    );
  }
}
