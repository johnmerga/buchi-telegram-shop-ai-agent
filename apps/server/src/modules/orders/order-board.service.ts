import type { OrderBoardItem } from '@buchi/shared';
import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import type { OrderBoardRepo } from './order-board.repo';

/** The board shows the latest orders. Older ones belong in reports, not on a live screen. */
const BOARD_SIZE = 100;

export class OrderBoardService {
  constructor(
    private readonly db: Database,
    private readonly repo: OrderBoardRepo,
  ) {}

  recent(shopId: string): Promise<OrderBoardItem[]> {
    return withShop(this.db, shopId, async (tx) => {
      const rows = await this.repo.recent(tx, BOARD_SIZE);
      if (rows.length === 0) return [];
      const lines = await this.repo.lines(
        tx,
        rows.map((row) => row.id),
      );
      return rows.map((row) => ({
        ...row,
        paymentDeadline: row.paymentDeadline?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        lines: lines
          .filter((line) => line.orderId === row.id)
          .map(({ title, size, quantity }) => ({ title, size, quantity })),
      }));
    });
  }
}
