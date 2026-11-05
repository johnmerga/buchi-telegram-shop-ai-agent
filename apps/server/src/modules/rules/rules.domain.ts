import { formatBirr, Money, type DeliverySettings, type PricingMode } from '@buchi/shared';
import type { z } from 'zod';
import { AppError } from '../../shared/errors';
import { ethiopianClockText, westernTime } from './ethiopian-time.domain';
import type {
  DeliveryPauseProposal,
  PromotionParameters,
  PromotionProposal,
  RuleProposal,
  settingsChangeSchema,
  TimeOfDay,
} from './rules.schemas';

export type SettingsChange = z.output<typeof settingsChangeSchema>;

/** A proposal with exact times, as stored once the owner confirms it. */
export type ResolvedRule = { startsAt: Date; endsAt: Date | null } & (
  | { type: 'delivery_pause'; parameters: Record<string, never> }
  | { type: 'promotion'; parameters: PromotionParameters }
  | { type: 'delivery_settings'; parameters: SettingsChange }
);

/** Addis Ababa is UTC+3 all year, without daylight saving time. */
const ADDIS_UTC_OFFSET_HOURS = 3;
const DAY_MS = 24 * 60 * 60_000;

/** The instant of a time of day on a date in Addis Ababa, `plusDays` days later. */
function addisInstant(date: string, hour: number, minute: number, plusDays = 0): Date {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + plusDays, hour - ADDIS_UTC_OFFSET_HOURS, minute));
}

function instantOf(date: string, time: TimeOfDay): Date {
  if (time.clock === 'western') return addisInstant(date, time.hour, time.minute);
  const western = westernTime(time);
  return addisInstant(date, western.hour, western.minute, western.nextDay ? 1 : 0);
}

/**
 * Turns the owner's words into exact times. The schema already refused a period that ends before
 * it starts; a rule that would already be over is refused here, because that depends on now.
 */
export function resolveRule(proposal: RuleProposal, now: Date): ResolvedRule {
  const { deliveryPause, promotion, deliverySettings } = proposal;
  if (deliveryPause) {
    return notOver({ type: 'delivery_pause', ...pausePeriod(deliveryPause), parameters: {} }, now);
  }
  if (promotion) return notOver(resolvePromotion(promotion), now);
  if (deliverySettings) {
    return { type: 'delivery_settings', startsAt: now, endsAt: null, parameters: deliverySettings };
  }
  throw new AppError('VALIDATION_FAILED', 'The rule has no section for its type.');
}

/** From the start of the day when no start time is given, to the end of the last day. */
export function pausePeriod(pause: DeliveryPauseProposal): { startsAt: Date; endsAt: Date } {
  const startsAt = pause.from ? instantOf(pause.date, pause.from) : addisInstant(pause.date, 0, 0);
  const lastDate = pause.untilDate ?? pause.date;
  const endsAt = pause.until ? instantOf(lastDate, pause.until) : addisInstant(lastDate, 0, 0, 1);
  return { startsAt, endsAt };
}

function resolvePromotion(promotion: PromotionProposal): ResolvedRule {
  const { percentOff, keywords, startDate, endDate } = promotion;
  return {
    type: 'promotion',
    startsAt: addisInstant(startDate, 0, 0),
    endsAt: addisInstant(endDate, 0, 0, 1),
    parameters: { percentOff, keywords },
  };
}

function notOver(rule: ResolvedRule, now: Date): ResolvedRule {
  if (rule.endsAt !== null && rule.endsAt <= now) {
    throw new AppError('VALIDATION_FAILED', 'The rule would already be over.');
  }
  return rule;
}

interface PromotableProduct {
  title: string;
  description: string;
  pricingMode: PricingMode;
}

/** A promotion matches a product whose title or description contains one of its words. */
export function matchesPromotion(product: PromotableProduct, promotion: PromotionParameters) {
  if (product.pricingMode !== 'fixed') return false;
  if (promotion.keywords.length === 0) return true;
  const text = `${product.title}\n${product.description}`.toLowerCase();
  return promotion.keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

const WHOLE_BIRR = Money.of('1');

/**
 * The price a fixed-price product sells at during the owner's promotions. Promotions apply only to
 * fixed prices: a negotiable product keeps its own range, so nothing can go below its lowest
 * price. Overlapping promotions do not add up; the largest one applies. The discount rounds up to
 * whole birr, so the customer always gets at least the promised percentage.
 */
export function promotedPrice(
  product: PromotableProduct & { price: Money },
  promotions: readonly PromotionParameters[],
): Money {
  const percentOff = Math.max(
    0,
    ...promotions.filter((p) => matchesPromotion(product, p)).map((p) => p.percentOff),
  );
  if (percentOff === 0) return product.price;
  const discount = product.price.times(percentOff).divideRoundingUp(100).roundUpTo(WHOLE_BIRR);
  return product.price.subtract(discount);
}

const addisDay = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Addis_Ababa',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

const addisHourMinute = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Addis_Ababa',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Such as "Sat 7 Nov, 16:00 (ከቀኑ 10 ሰዓት)", so the owner sees both clocks. */
function whenText(instant: Date): string {
  const [hour = 0, minute = 0] = addisHourMinute.format(instant).split(':').map(Number);
  const clock = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return `${addisDay.format(instant)}, ${clock} (${ethiopianClockText(hour, minute)})`;
}

/** The last day of a period that ends at midnight, such as a promotion's last day. */
function lastDayText(endsAt: Date): string {
  return addisDay.format(new Date(endsAt.getTime() - DAY_MS / 2));
}

export function pausePreview(rule: { startsAt: Date; endsAt: Date | null }): string {
  return [
    '⏸ ዴሊቨሪ ይቆማል / Pause deliveries',
    `From: ${whenText(rule.startsAt)}`,
    `Until: ${rule.endsAt ? whenText(rule.endsAt) : 'you start them again'}`,
    'Customers who order meanwhile get pickup at the shop.',
  ].join('\n');
}

const SHOWN_MATCHES = 5;

export function promotionPreview(
  rule: { startsAt: Date; endsAt: Date | null; parameters: PromotionParameters },
  matchingTitles: string[],
): string {
  const { percentOff, keywords } = rule.parameters;
  const scope =
    keywords.length === 0
      ? 'every fixed-price product'
      : `fixed-price products with "${keywords.join('", "')}"`;
  const shown = matchingTitles.slice(0, SHOWN_MATCHES).join(', ');
  const more = matchingTitles.length > SHOWN_MATCHES ? ', …' : '';
  return [
    `🏷 ቅናሽ / Promotion: ${String(percentOff)}% off ${scope}`,
    `From ${addisDay.format(rule.startsAt)} to ${rule.endsAt ? lastDayText(rule.endsAt) : 'further notice'}`,
    `Matches now: ${String(matchingTitles.length)}${matchingTitles.length > 0 ? ` (${shown}${more})` : ''}`,
    'Negotiable products keep their own price range.',
  ].join('\n');
}

const settingLabels: [keyof DeliverySettings, string][] = [
  ['baseFee', 'Base fee'],
  ['ratePerKm', 'Rate per km'],
  ['ratePerMinute', 'Rate per minute'],
  ['freeRadiusKm', 'Free radius (km)'],
  ['standardRangeKm', 'Standard range (km)'],
  ['farRangeKm', 'Far range (km)'],
  ['farCap', 'Far-area cap'],
  ['saverDiscountPercent', 'Saver discount (%)'],
];

const moneySettings = new Set<keyof DeliverySettings>([
  'baseFee',
  'ratePerKm',
  'ratePerMinute',
  'farCap',
]);

function settingText(key: keyof DeliverySettings, value: string | number): string {
  return moneySettings.has(key) ? formatBirr(String(value)) : String(value);
}

/** Each changed setting with its current value, if the shop has one. */
export function settingsPreview(current: DeliverySettings | undefined, change: SettingsChange) {
  const lines = settingLabels.flatMap(([key, label]) => {
    const after = change[key];
    if (after === undefined) return [];
    const before = current?.[key];
    const was = before === undefined ? '' : `${settingText(key, before)} → `;
    return [`${label}: ${was}${settingText(key, after)}`];
  });
  return ['⚙️ የዴሊቨሪ ቅንብር / Change delivery settings', ...lines].join('\n');
}
