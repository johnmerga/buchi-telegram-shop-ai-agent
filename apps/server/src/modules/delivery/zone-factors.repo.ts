import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { tripLegs, zoneTimeFactors } from '../../db/schema';
import type { TimeBand } from './factors.domain';

type NewTripLeg = typeof tripLegs.$inferInsert;
export type TripLegRow = typeof tripLegs.$inferSelect;

/** Trip legs and time factors are platform-wide, so this repo uses the database directly. */
export class ZoneFactorsRepo {
  constructor(private readonly db: Database) {}

  async insertLegs(legs: NewTripLeg[]): Promise<void> {
    if (legs.length === 0) return;
    await this.db.insert(tripLegs).values(legs);
  }

  async deleteSyntheticLegs(): Promise<void> {
    await this.db.delete(tripLegs).where(eq(tripLegs.synthetic, true));
  }

  legsSince(since: Date): Promise<TripLegRow[]> {
    return this.db.select().from(tripLegs).where(gte(tripLegs.startedAt, since));
  }

  /** Zones only ever gain trips, so every learned zone is written and none is removed. */
  async saveTimeFactors(
    rows: { zone: string; band: TimeBand; factor: number; trips: number }[],
  ): Promise<void> {
    if (rows.length === 0) return;
    await this.db
      .insert(zoneTimeFactors)
      .values(rows)
      .onConflictDoUpdate({
        target: [zoneTimeFactors.zone, zoneTimeFactors.band],
        set: {
          factor: sql`excluded.factor`,
          trips: sql`excluded.trips`,
          updatedAt: sql`now()`,
        },
      });
  }

  allTimeFactors(): Promise<{ zone: string; band: TimeBand; factor: number; trips: number }[]> {
    return this.db
      .select({
        zone: zoneTimeFactors.zone,
        band: zoneTimeFactors.band,
        factor: zoneTimeFactors.factor,
        trips: zoneTimeFactors.trips,
      })
      .from(zoneTimeFactors);
  }

  timeFactors(
    zones: string[],
    band: TimeBand,
  ): Promise<{ zone: string; factor: number; trips: number }[]> {
    return this.db
      .select({
        zone: zoneTimeFactors.zone,
        factor: zoneTimeFactors.factor,
        trips: zoneTimeFactors.trips,
      })
      .from(zoneTimeFactors)
      .where(and(inArray(zoneTimeFactors.zone, zones), eq(zoneTimeFactors.band, band)));
  }
}
