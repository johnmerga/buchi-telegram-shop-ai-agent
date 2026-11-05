import type { Database, Transaction } from '../../db/client';
import { withShop } from '../../db/with-shop';
import { AppError } from '../../shared/errors';
import type { DeliverySettingsRepo } from './delivery-settings.repo';
import { nextSaverRun } from './saver-schedule.domain';

export const SAVER_RUN_TIMER = 'delivery.saver_run';

interface TimerScheduler {
  schedule(
    tx: Transaction,
    kind: string,
    targetId: string,
    shopId: string | null,
    dueAt: Date,
  ): Promise<unknown>;
}

/**
 * When each shop's Saver runs happen. Owners set different times, so each shop has one chain of
 * timers instead of a fixed cron job: every run schedules the next one.
 */
export class SaverScheduleService {
  constructor(
    private readonly db: Database,
    private readonly settings: DeliverySettingsRepo,
    private readonly timers: TimerScheduler,
    private readonly now: () => Date,
  ) {}

  async setTimes(shopId: string, times: string[]): Promise<void> {
    const nextRunAt = nextSaverRun(times, this.now()) ?? null;
    await withShop(this.db, shopId, async (tx) => {
      const saved = await this.settings.setSaverSchedule(tx, shopId, { times, nextRunAt });
      if (!saved) throw new AppError('CONFLICT', 'Save the delivery settings first');
      if (nextRunAt) await this.timers.schedule(tx, SAVER_RUN_TIMER, shopId, shopId, nextRunAt);
    });
  }

  /**
   * Claims the run that a timer was due for and schedules the next one. Returns false for a timer
   * that a later change of the run times replaced.
   */
  claim(shopId: string, dueAt: Date): Promise<boolean> {
    return withShop(this.db, shopId, async (tx) => {
      const times = (await this.settings.saverRunTimes(tx)) ?? [];
      const nextRunAt = nextSaverRun(times, this.now()) ?? null;
      const claimed = await this.settings.advanceSaverRun(tx, shopId, dueAt, nextRunAt);
      if (claimed && nextRunAt) {
        await this.timers.schedule(tx, SAVER_RUN_TIMER, shopId, shopId, nextRunAt);
      }
      return claimed;
    });
  }
}
