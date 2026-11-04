import type { Update } from 'grammy/types';
import type { TelegramUpdatesRepo } from './updates.repo';
import type { UpdateWorker } from './worker';

/** Accepts webhook updates: stores each one once, then wakes the worker. */
export class TelegramIngress {
  constructor(
    private readonly repo: TelegramUpdatesRepo,
    private readonly worker: UpdateWorker,
  ) {}

  async receive(update: Update): Promise<void> {
    if (await this.repo.insertIfNew(update)) {
      this.worker.wake();
    }
  }
}
