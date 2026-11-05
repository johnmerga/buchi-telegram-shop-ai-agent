import type { Transaction } from '../../db/client';
import { replyTimes } from '../../db/schema';

export class ReplyTimesRepo {
  async insert(
    tx: Transaction,
    reply: { shopId: string; receivedAt: Date; repliedAt: Date },
  ): Promise<void> {
    await tx.insert(replyTimes).values(reply);
  }
}
