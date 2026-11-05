import { eq, and, sql } from 'drizzle-orm';
import type { Transaction } from '../../db/client';
import { landmarks } from '../../db/schema';
import type { LandmarkName } from './landmarks.domain';
import type { Coordinates } from './location.domain';

type LandmarkRow = typeof landmarks.$inferSelect;

export class LandmarksRepo {
  async find(tx: Transaction, landmark: LandmarkName): Promise<LandmarkRow | undefined> {
    const [row] = await tx
      .select()
      .from(landmarks)
      .where(and(eq(landmarks.name, landmark.name), eq(landmarks.area, landmark.area)));
    return row;
  }

  /** The latest confirmed pin wins, because a customer just checked it on the map. */
  async confirm(
    tx: Transaction,
    shopId: string,
    landmark: LandmarkName,
    coordinates: Coordinates,
  ): Promise<void> {
    await tx
      .insert(landmarks)
      .values({ shopId, ...landmark, ...coordinates })
      .onConflictDoUpdate({
        target: [landmarks.shopId, landmarks.name, landmarks.area],
        set: {
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
          confirmations: sql`${landmarks.confirmations} + 1`,
          updatedAt: sql`now()`,
        },
      });
  }
}
