import type { Update } from 'grammy/types';
import type { Logger } from 'pino';
import type { TelegramUpdatesRepo } from './updates.repo';

export type UpdateHandler = (update: Update) => Promise<void>;

/** Processes stored updates one at a time, in order, in the background of this process. */
export class UpdateWorker {
  private running: Promise<void> | undefined;
  private wakeRequested = false;

  constructor(
    private readonly repo: TelegramUpdatesRepo,
    private readonly handle: UpdateHandler,
    private readonly logger: Logger,
  ) {}

  /** Starts processing pending updates, or makes the running loop check again when it finishes. */
  wake(): void {
    this.wakeRequested = true;
    this.running ??= this.loop();
  }

  /** Resolves when no update is being processed. */
  async idle(): Promise<void> {
    await this.running;
  }

  private async loop(): Promise<void> {
    while (this.wakeRequested) {
      this.wakeRequested = false;
      for (let update = await this.repo.claimNext(); update; update = await this.repo.claimNext()) {
        await this.process(update);
      }
    }
    this.running = undefined;
  }

  private async process(update: Update): Promise<void> {
    try {
      await this.handle(update);
      await this.repo.markDone(update.update_id);
    } catch (err) {
      this.logger.error({ err, updateId: update.update_id }, 'telegram update failed');
      await this.repo.markFailed(
        update.update_id,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}
