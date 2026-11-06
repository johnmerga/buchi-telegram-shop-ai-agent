import { randomBytes } from 'node:crypto';
import type { DriverListItem } from '@buchi/shared';
import type { Database } from '../../db/client';
import { isUniqueViolation } from '../../db/errors';
import { withShop } from '../../db/with-shop';
import { AppError } from '../../shared/errors';
import type { ShopsService } from '../shops/shops.service';
import {
  checkInvite,
  currentWork,
  hashInviteToken,
  INVITE_TTL_MS,
  type InviteProblem,
} from './drivers.domain';
import type { DriversRepo } from './drivers.repo';
import { inviteStartPayload } from './drivers.schemas';

export interface DriverInviteLink {
  driverId: string;
  link: string;
  expiresAt: Date;
}

export type LinkResult =
  | { status: 'linked'; shopName: string; needsPhone: boolean }
  | { status: InviteProblem | 'already_linked' };

export type AvailabilityResult = 'saved' | 'needs_phone';

/** The Telegram user who opened an invite link. */
interface Opener {
  telegramUserId: number;
  username: string | undefined;
  name: string;
}

/** Adds drivers to shops through one-time invite links, and keeps their phone and availability. */
export class DriverService {
  constructor(
    private readonly db: Database,
    private readonly repo: DriversRepo,
    private readonly shops: Pick<ShopsService, 'get'>,
    private readonly botUsername: string,
    private readonly now: () => Date,
  ) {}

  /** A bot cannot message someone first, so the owner sends the driver this link. */
  async invite(shopId: string, username: string): Promise<DriverInviteLink> {
    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(this.now().getTime() + INVITE_TTL_MS);
    const driver = await withShop(this.db, shopId, (tx) =>
      this.repo.invite(tx, { shopId, username, tokenHash: hashInviteToken(token), expiresAt }),
    );
    if (!driver) throw new AppError('CONFLICT', 'This driver has already joined the shop');
    const link = `https://t.me/${this.botUsername}?start=${inviteStartPayload(token)}`;
    return { driverId: driver.id, link, expiresAt };
  }

  /**
   * The shop's drivers for the owner, with what each is doing now. Phone numbers stay out until a
   * driver takes a job.
   */
  async list(shopId: string): Promise<DriverListItem[]> {
    const { rows, work } = await withShop(this.db, shopId, async (tx) => ({
      rows: await this.repo.list(tx),
      work: currentWork(await this.repo.openStops(tx)),
    }));
    return rows.map((row) => ({
      id: row.id,
      username: row.username,
      name: row.name,
      linked: row.telegramUserId !== null,
      available: row.available,
      inviteExpiresAt: row.inviteExpiresAt?.toISOString() ?? null,
      work: work.get(row.id) ?? null,
    }));
  }

  /** Links the invited username to the Telegram user ID of whoever opened the link. */
  async link(token: string, opener: Opener): Promise<LinkResult> {
    const tokenHash = hashInviteToken(token);
    const shopId = await this.repo.inviteShopId(this.db, tokenHash);
    if (!shopId) return { status: 'invalid' };
    try {
      const result = await withShop(this.db, shopId, async (tx) => {
        const invite = await this.repo.findByInvite(tx, tokenHash);
        if (!invite?.inviteExpiresAt) return { status: 'invalid' as const };
        const now = this.now();
        const problem = checkInvite(
          { username: invite.username, expiresAt: invite.inviteExpiresAt },
          opener,
          now,
        );
        if (problem) return { status: problem };
        const linked = await this.repo.link(tx, tokenHash, { ...opener, linkedAt: now });
        return linked
          ? { status: 'linked' as const, needsPhone: invite.phone === null }
          : { status: 'invalid' as const };
      });
      if (result.status !== 'linked') return result;
      return { ...result, shopName: (await this.shops.get(shopId)).name };
    } catch (err) {
      // The same Telegram account under another username, after a username change.
      if (isUniqueViolation(err)) return { status: 'already_linked' };
      throw err;
    }
  }

  shopIds(telegramUserId: number): Promise<string[]> {
    return this.repo.shopIdsOf(this.db, telegramUserId);
  }

  /** Saves the phone in every shop that lacks it. Returns false when no shop needed it. */
  async savePhone(telegramUserId: number, phone: string): Promise<boolean> {
    let saved = false;
    for (const shopId of await this.shopIds(telegramUserId)) {
      const updated = await withShop(this.db, shopId, (tx) =>
        this.repo.setPhoneIfMissing(tx, telegramUserId, phone),
      );
      saved ||= updated;
    }
    return saved;
  }

  /** Availability is the same in every shop, so the first shop tells it. */
  async isAvailable(telegramUserId: number): Promise<boolean> {
    const [shopId] = await this.shopIds(telegramUserId);
    if (!shopId) return false;
    const driver = await withShop(this.db, shopId, (tx) =>
      this.repo.byTelegramUser(tx, telegramUserId),
    );
    return driver?.available ?? false;
  }

  /** One person has one availability, in every shop they drive for. Customers need their phone. */
  async setAvailability(telegramUserId: number, available: boolean): Promise<AvailabilityResult> {
    const shopIds = await this.shopIds(telegramUserId);
    if (available) {
      for (const shopId of shopIds) {
        const driver = await withShop(this.db, shopId, (tx) =>
          this.repo.byTelegramUser(tx, telegramUserId),
        );
        if (driver?.phone === null) return 'needs_phone';
      }
    }
    for (const shopId of shopIds) {
      await withShop(this.db, shopId, (tx) =>
        this.repo.setAvailable(tx, telegramUserId, available),
      );
    }
    return 'saved';
  }
}
