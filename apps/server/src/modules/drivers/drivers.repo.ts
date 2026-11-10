import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Database, Transaction } from '../../db/client';
import { deliveryJobs, drivers, jobStops } from '../../db/schema';
import type { OpenStop } from './drivers.domain';

export type DriverRow = typeof drivers.$inferSelect;

/** A linked driver who can take jobs: Buchi knows their Telegram chat and phone number. */
export interface ReachableDriver {
  id: string;
  telegramUserId: number;
}

export class DriversRepo {
  /**
   * Adds the driver, or gives a driver who has not linked yet a new invite, which replaces the old
   * link. Returns nothing when the username already belongs to a linked driver.
   */
  async invite(
    tx: Transaction,
    invite: { shopId: string; username: string; tokenHash: string; expiresAt: Date },
  ): Promise<{ id: string } | undefined> {
    const values = { inviteTokenHash: invite.tokenHash, inviteExpiresAt: invite.expiresAt };
    const [row] = await tx
      .insert(drivers)
      .values({ shopId: invite.shopId, username: invite.username, ...values })
      .onConflictDoUpdate({
        target: [drivers.shopId, drivers.username],
        set: values,
        setWhere: isNull(drivers.telegramUserId),
      })
      .returning({ id: drivers.id });
    return row;
  }

  /**
   * Looks across all shops, which row-level security blocks, through the `driver_invite_shop_id`
   * database function. Only someone with the token can compute its hash.
   */
  async inviteShopId(db: Database, tokenHash: string): Promise<string | null> {
    const [row] = await db.execute<{ shop_id: string | null }>(
      sql`select driver_invite_shop_id(${tokenHash}) as shop_id`,
    );
    return row?.shop_id ?? null;
  }

  async findByInvite(tx: Transaction, tokenHash: string): Promise<DriverRow | undefined> {
    const [row] = await tx.select().from(drivers).where(eq(drivers.inviteTokenHash, tokenHash));
    return row;
  }

  /** Uses up the invite in the same statement, so one link can link only one Telegram account. */
  async link(
    tx: Transaction,
    tokenHash: string,
    user: { telegramUserId: number; name: string; linkedAt: Date },
  ): Promise<boolean> {
    const linked = await tx
      .update(drivers)
      .set({
        telegramUserId: user.telegramUserId,
        name: user.name,
        linkedAt: user.linkedAt,
        inviteTokenHash: null,
        inviteExpiresAt: null,
      })
      .where(eq(drivers.inviteTokenHash, tokenHash))
      .returning({ id: drivers.id });
    return linked.length > 0;
  }

  /** Looks across all shops through the `driver_shop_ids` database function. */
  async shopIdsOf(db: Database, telegramUserId: number): Promise<string[]> {
    const rows = await db.execute<{ shop_id: string }>(
      sql`select shop_id from driver_shop_ids(${telegramUserId}) as shop_id`,
    );
    return rows.map((row) => row.shop_id);
  }

  list(tx: Transaction): Promise<DriverRow[]> {
    return tx.select().from(drivers).orderBy(desc(drivers.createdAt));
  }

  /** Undelivered stops of accepted jobs, each driver's earliest job and next stop first. */
  async openStops(tx: Transaction): Promise<OpenStop[]> {
    const rows = await tx
      .select({
        driverId: deliveryJobs.driverId,
        jobStatus: deliveryJobs.status,
        orderId: jobStops.orderId,
      })
      .from(deliveryJobs)
      .innerJoin(jobStops, eq(jobStops.jobId, deliveryJobs.id))
      .where(
        and(inArray(deliveryJobs.status, ['assigned', 'picked_up']), isNull(jobStops.deliveredAt)),
      )
      .orderBy(asc(deliveryJobs.acceptedAt), asc(jobStops.position));
    // The filter above leaves only these statuses, and an accepted job always has a driver.
    return rows.flatMap(({ driverId, jobStatus, orderId }) =>
      driverId !== null && (jobStatus === 'assigned' || jobStatus === 'picked_up')
        ? [{ driverId, jobStatus, orderId }]
        : [],
    );
  }

  async byTelegramUser(tx: Transaction, telegramUserId: number): Promise<DriverRow | undefined> {
    const [row] = await tx.select().from(drivers).where(eq(drivers.telegramUserId, telegramUserId));
    return row;
  }

  async find(tx: Transaction, driverId: string): Promise<DriverRow | undefined> {
    const [row] = await tx.select().from(drivers).where(eq(drivers.id, driverId));
    return row;
  }

  /** Never overwrites a saved phone, so a driver who shares a contact to buy keeps theirs. */
  async setPhoneIfMissing(
    tx: Transaction,
    telegramUserId: number,
    phone: string,
  ): Promise<boolean> {
    const updated = await tx
      .update(drivers)
      .set({ phone })
      .where(and(eq(drivers.telegramUserId, telegramUserId), isNull(drivers.phone)))
      .returning({ id: drivers.id });
    return updated.length > 0;
  }

  async setAvailable(tx: Transaction, telegramUserId: number, available: boolean): Promise<void> {
    await tx.update(drivers).set({ available }).where(eq(drivers.telegramUserId, telegramUserId));
  }

  async available(tx: Transaction): Promise<ReachableDriver[]> {
    const rows = await tx
      .select({ id: drivers.id, telegramUserId: drivers.telegramUserId })
      .from(drivers)
      .where(
        and(
          eq(drivers.available, true),
          isNotNull(drivers.telegramUserId),
          isNotNull(drivers.phone),
        ),
      )
      .orderBy(drivers.linkedAt);
    return rows.flatMap((row) =>
      row.telegramUserId === null ? [] : [{ id: row.id, telegramUserId: row.telegramUserId }],
    );
  }
}
