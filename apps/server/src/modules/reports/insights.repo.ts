import type { Insights, PostResult, Rate } from '@buchi/shared';
import { and, count, desc, eq, gte, inArray, isNotNull, notInArray, sql } from 'drizzle-orm';
import type { Transaction } from '../../db/client';
import {
  agentDecisions,
  channelPosts,
  farQuotes,
  orderItems,
  orders,
  paymentProofs,
  products,
  productVariants,
  replyTimes,
} from '../../db/schema';
import { paidStatuses } from '../orders/orders.domain';

/** The design doc's target: a far-area quote finds a driver within 10 minutes. Raises come every five. */
const RAISES_WITHIN_TEN_MINUTES = 1;
/** The insights list the latest posts. Older ones have stopped selling. */
const POSTS_SHOWN = 10;

/** Read-only queries for the success metrics. Every query runs inside `withShop`. */
export class InsightsRepo {
  /** Approvals by Buchi, out of every approval, by when the screenshot arrived. */
  async autoApprovedPayments(tx: Transaction, since: Date): Promise<Rate> {
    const [row] = await tx
      .select({
        auto: sql<number>`count(*) filter (where ${paymentProofs.decision} = 'approve')::int`,
        owner: sql<number>`count(*) filter (where ${paymentProofs.ownerDecision} = 'approved')::int`,
      })
      .from(paymentProofs)
      .where(gte(paymentProofs.createdAt, since));
    const auto = row?.auto ?? 0;
    return { count: auto, total: auto + (row?.owner ?? 0) };
  }

  /**
   * Quotes that reached drivers, and those a driver held before the second raise. An owner-approved
   * price never rises, so it counts as found in time whenever it was held.
   */
  async farQuotesDriverFound(tx: Transaction, since: Date): Promise<Rate> {
    const [row] = await tx
      .select({
        total: count(),
        found: sql<number>`count(*) filter (where ${farQuotes.heldPrice} is not null and ${farQuotes.raises} <= ${RAISES_WITHIN_TEN_MINUTES})::int`,
      })
      .from(farQuotes)
      .where(
        and(
          eq(farQuotes.synthetic, false),
          gte(farQuotes.createdAt, since),
          notInArray(farQuotes.status, ['estimating', 'awaiting_owner', 'pickup']),
        ),
      );
    return { count: row?.found ?? 0, total: row?.total ?? 0 };
  }

  async firstReply(tx: Transaction, since: Date): Promise<Insights['firstReply']> {
    const seconds = sql`extract(epoch from ${replyTimes.repliedAt} - ${replyTimes.receivedAt})`;
    const [row] = await tx
      .select({
        replies: count(),
        medianSeconds: sql<
          number | null
        >`(percentile_cont(0.5) within group (order by ${seconds}))::float8`,
      })
      .from(replyTimes)
      .where(gte(replyTimes.receivedAt, since));
    return { replies: row?.replies ?? 0, medianSeconds: row?.medianSeconds ?? null };
  }

  async guardResults(tx: Transaction, since: Date): Promise<Insights['guard']> {
    const rows = await tx
      .select({ result: agentDecisions.result, count: count() })
      .from(agentDecisions)
      .where(gte(agentDecisions.createdAt, since))
      .groupBy(agentDecisions.result);
    const of = (result: string) => rows.find((row) => row.result === result)?.count ?? 0;
    return { accepted: of('accepted'), rejected: of('rejected'), needsOwner: of('needs_owner') };
  }

  /**
   * The latest channel posts with their Buy taps and the paid orders of their product placed since
   * the post. A product posted twice credits its orders to both posts.
   */
  async postResults(tx: Transaction): Promise<PostResult[]> {
    const paidOrders = tx
      .select({ count: sql<number>`count(distinct ${orders.id})::int` })
      .from(orders)
      .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
      .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
      .where(
        and(
          eq(productVariants.productId, channelPosts.productId),
          gte(orders.createdAt, channelPosts.createdAt),
          inArray(orders.status, [...paidStatuses]),
        ),
      );
    const rows = await tx
      .select({
        postId: channelPosts.id,
        productTitle: products.title,
        postedAt: channelPosts.createdAt,
        taps: channelPosts.taps,
        paidOrders: sql<number>`(${paidOrders})`,
      })
      .from(channelPosts)
      .innerJoin(products, eq(products.id, channelPosts.productId))
      // A post without a message ID never reached the channel.
      .where(isNotNull(channelPosts.messageId))
      .orderBy(desc(channelPosts.createdAt))
      .limit(POSTS_SHOWN);
    return rows.map((row) => ({ ...row, postedAt: row.postedAt.toISOString() }));
  }
}
