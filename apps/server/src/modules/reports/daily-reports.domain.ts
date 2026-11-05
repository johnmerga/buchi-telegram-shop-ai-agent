import { formatBirr, type MoneyString } from '@buchi/shared';

/** A size with this many units or fewer left for sale counts as low stock in the morning brief. */
export const LOW_STOCK_UNITS = 2;
/** Messages list this many items at most, so a long list does not bury the rest of the brief. */
const MAX_LISTED = 8;

/** One Addis Ababa day of a shop, as the evening summary reports it. */
export interface EveningSummary {
  /** Such as "2026-11-05". */
  day: string;
  ordersCreated: number;
  ordersPaid: number;
  revenue: MoneyString;
  deliveryCost: MoneyString;
  saverSavings: MoneyString;
  fraudBlocked: number;
  fraudBlockedAmount: MoneyString;
  openReviews: number;
}

export interface LowStockItem {
  title: string;
  size: string;
  available: number;
}

export interface WaitlistDemand {
  title: string;
  size: string;
  waiting: number;
}

export interface MorningBrief {
  lowStock: LowStockItem[];
  openReviews: number;
  waitlist: WaitlistDemand[];
  /** Customers who asked to hear about a product the shop does not have, in the last week. */
  notifyRequests: number;
}

export function eveningSummaryText(summary: EveningSummary): string {
  return [
    `🌇 የዕለቱ ማጠቃለያ / Evening summary · ${summary.day}`,
    `🛒 ትዕዛዞች / Orders: ${String(summary.ordersCreated)} · ተከፍሏል / paid: ${String(summary.ordersPaid)}`,
    `💰 ገቢ / Revenue: ${formatBirr(summary.revenue)}`,
    `🛵 የማድረሻ ወጪ / Delivery cost: ${formatBirr(summary.deliveryCost)}`,
    `💡 Saver ቁጠባ / Saver savings: ${formatBirr(summary.saverSavings)}`,
    `🛡️ የታገዱ ማጭበርበሮች / Fraud blocked: ${String(summary.fraudBlocked)} (${formatBirr(summary.fraudBlockedAmount)})`,
    `⏳ ግምገማ የሚጠብቁ / Open reviews: ${String(summary.openReviews)}`,
  ].join('\n');
}

export function morningBriefText(brief: MorningBrief): string {
  return [
    '🌅 የጠዋት መግለጫ / Morning brief',
    '',
    '📦 ዝቅተኛ ክምችት / Low stock:',
    ...listed(
      brief.lowStock,
      (item) =>
        `• ${item.title} · ${item.size}: ${String(item.available)} ቀርቷል / left${
          item.available === 0 ? ' ⚠️' : ''
        }`,
      '• ሁሉም በቂ ነው / Every size is in stock',
    ),
    '',
    `⏳ ግምገማ የሚጠብቁ / Open reviews: ${String(brief.openReviews)}`,
    '',
    '🔔 ተጠባባቂዎች / Waitlist:',
    ...listed(
      brief.waitlist,
      (item) => `• ${item.title} · ${item.size}: ${String(item.waiting)} ሰው / waiting`,
      '• ማንም የለም / Nobody is waiting',
    ),
    `📷 "አሳውቁኝ" ጥያቄዎች / Notify-me requests (7 days): ${String(brief.notifyRequests)}`,
  ].join('\n');
}

function listed<T>(items: T[], line: (item: T) => string, empty: string): string[] {
  if (items.length === 0) return [empty];
  const shown = items.slice(0, MAX_LISTED).map(line);
  const more = items.length - MAX_LISTED;
  return more > 0 ? [...shown, `… +${String(more)}`] : shown;
}
