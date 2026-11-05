import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import { noteZone } from './area-notes.domain';
import type { AreaNoteRow, AreaNotesRepo } from './area-notes.repo';
import type { Coordinates } from './location.domain';

/**
 * Notes about areas, such as a driver's report of a closed road. Only the zone is stored, never
 * the point, so a note cannot reveal a customer's door.
 */
export class AreaNoteService {
  constructor(
    private readonly db: Database,
    private readonly repo: AreaNotesRepo,
    private readonly now: () => Date,
  ) {}

  async addDriverReport(
    shopId: string,
    report: { near: Coordinates; note: string; validHours: number },
  ): Promise<void> {
    const expiresAt = new Date(this.now().getTime() + report.validHours * 60 * 60_000);
    await withShop(this.db, shopId, (tx) =>
      this.repo.insert(tx, {
        shopId,
        zone: noteZone(report.near),
        note: report.note,
        source: 'driver',
        expiresAt,
      }),
    );
  }

  /** The current notes about the area around a point, newest first. */
  near(shopId: string, point: Coordinates): Promise<AreaNoteRow[]> {
    return withShop(this.db, shopId, (tx) => this.repo.current(tx, noteZone(point), this.now()));
  }
}
