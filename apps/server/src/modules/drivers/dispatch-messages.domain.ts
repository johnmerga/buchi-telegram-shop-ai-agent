import { formatBirr, type MoneyString } from '@buchi/shared';
import type { Coordinates } from '../delivery/location.domain';
import { orderReference } from '../orders/orders.domain';
import { mapsLink } from './dispatch.domain';

/**
 * What a driver sees before accepting: never the customer's name, phone, or pin. A special offer
 * is a far-area job, whose customer pays only after a driver holds the price.
 */
export function offerText(offer: {
  special: boolean;
  shopName: string;
  stops: number;
  routeMeters: number;
  estimatedMinutes: number;
  price: MoneyString;
  raiseStep: number;
}): string {
  const km = (offer.routeMeters / 1000).toFixed(1);
  const stops = offer.stops === 1 ? '1 stop' : `${String(offer.stops)} stops`;
  if (offer.special) {
    return [
      `⭐ ልዩ ስራ / Special offer · ${offer.shopName}`,
      `Far area · ${stops} · ~${km} km · ~${String(offer.estimatedMinutes)} min`,
      `ክፍያ / Payout: ${formatBirr(offer.price)}${offer.raiseStep > 0 ? ' (raised)' : ''}`,
      'Accept to hold it. The job is yours once the customer confirms and pays.',
    ].join('\n');
  }
  return [
    `🛵 አዲስ ስራ / New delivery job · ${offer.shopName}`,
    `${stops} · ~${km} km · ~${String(offer.estimatedMinutes)} min`,
    `ክፍያ / Payout: ${formatBirr(offer.price)}${offer.raiseStep > 0 ? ' (bonus included)' : ''}`,
  ].join('\n');
}

export const takenNotice = '❌ ይህ ስራ ተወስዷል / Another driver took this job.';
export const raisedNotice = '⏫ This offer was replaced by a higher payout. See the new message.';
export const acceptedNotice = '✅ ስራውን ወስደዋል / You took this job. The details follow.';
export const heldNotice =
  '⏳ ይዘዋል / You hold this job. The details come once the customer pays; we will tell you if they decline.';
export const withdrawnNotice = '🚫 ይህ ልዩ ስራ ተሰርዟል / This special offer was withdrawn.';

export interface StopDetails {
  position: number;
  orderId: string;
  customerName: string;
  phone: string | null;
  pin: Coordinates;
  lines: { title: string; size: string; quantity: number }[];
}

/** Shown only after the driver accepts. */
export function jobDetails(job: {
  shopName: string;
  shopPin: Coordinates | null;
  payout: MoneyString;
  stops: StopDetails[];
}): string {
  const pickup = job.shopPin ? ` ${mapsLink(job.shopPin)}` : '';
  return [
    `📦 ከሱቁ ይውሰዱ / Pick up at ${job.shopName}${pickup}`,
    ...job.stops.map(stopDetails),
    `ክፍያ / Payout: ${formatBirr(job.payout)}`,
    'Tap Picked up once you have every parcel.',
  ].join('\n\n');
}

function stopDetails(stop: StopDetails): string {
  const items = stop.lines.map(
    (line) =>
      `   ${line.title} · ${line.size}${line.quantity > 1 ? ` × ${String(line.quantity)}` : ''}`,
  );
  return [
    `${String(stop.position)}. ${stop.customerName} · ${orderReference(stop.orderId)}`,
    `   📞 ${stop.phone ?? 'no phone'}`,
    `   📍 ${mapsLink(stop.pin)}`,
    ...items,
  ].join('\n');
}

export function deliverPrompt(stop: { position: number; customerName: string }): string {
  return `${String(stop.position)}. ${stop.customerName}: tap Delivered at the door / ሲያደርሱ ይጫኑ.`;
}

/** Sent once a trip starts, so customers can follow the driver on a map. */
export const liveLocationRequest =
  '📡 የቀጥታ ቦታዎን ያጋሩ / Please share your Live Location here: 📎 → Location → Share My Live Location. Customers will see you on a map, and Delivered will use it.';

export function liveMapIntro(orderId: string): string {
  const reference = orderReference(orderId);
  return `🛵 ሹፌርዎ በካርታ ላይ / Your driver for order ${reference} is on the way. Follow them on this live map:`;
}

export const shareLocationPrompt = '📍 ቦታዎን ያጋሩ / Share your location to confirm the delivery.';

export function deliveredReply(orderId: string, jobDone: boolean): string {
  const reference = orderReference(orderId);
  return jobDone
    ? `✅ ${reference} delivered. The job is complete, thank you! / አመሰግናለሁ!`
    : `✅ ${reference} delivered. On to the next stop.`;
}

export function onTheWay(orderId: string, driver: { name: string; phone: string | null }): string {
  const reference = orderReference(orderId);
  const phone = driver.phone === null ? '' : ` · 📞 ${driver.phone}`;
  return [
    `🛵 ትዕዛዝ ${reference} በመንገድ ላይ ነው / Order ${reference} is on its way.`,
    `ሹፌር / Driver: ${driver.name}${phone}`,
  ].join('\n');
}

export function deliveredQuestion(orderId: string): string {
  const reference = orderReference(orderId);
  return `📦 ትዕዛዝ ${reference} ደርሷል / Order ${reference} was delivered. Did you receive it?`;
}

export function readyForPickup(
  orderId: string,
  shop: { name: string; pin: Coordinates | null },
): string {
  const reference = orderReference(orderId);
  return [
    `🛍️ ትዕዛዝ ${reference} ዝግጁ ነው / Order ${reference} is ready for pickup at ${shop.name}.`,
    ...(shop.pin ? [`📍 ${mapsLink(shop.pin)}`] : []),
  ].join('\n');
}

export const receivedThanks = 'አመሰግናለሁ / Thank you for confirming!';

export const driverProblemPrompt =
  '✍️ ምን ተፈጠረ? / What happened? Write it here, and Buchi will tell the customer and the shop.';

/** Only the distance: the driver's coordinates never reach an owner's chat or the logs. */
export function offPinAlert(orderId: string, metersFromPin: number): string {
  return [
    `⚠️ ${orderReference(orderId)} was marked delivered ${String(metersFromPin)} m from the customer's pin.`,
    'Please check with the driver.',
  ].join(' ');
}

export function availabilityText(available: boolean): string {
  return available
    ? '🟢 ስራ ላይ ነዎት / You are available. New jobs will come here.'
    : '⚪ ከስራ ውጪ ነዎት / You are off duty. Tap Available when you are ready for jobs.';
}

export const phoneRequest =
  '📞 ስልክ ቁጥርዎን ያጋሩ / Share your phone number, so customers can call you.';
