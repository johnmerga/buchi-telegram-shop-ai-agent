import { formatBirr, Money } from '@buchi/shared';
import type { Route } from '../delivery/distance.domain';
import type { DeliveryOption, DeliveryQuote } from '../delivery/fees.domain';
import type { PinProblem } from '../delivery/location.domain';
import type { Button } from '../owner/owner.domain';
import { deliveryChoiceCallback } from './orders.schemas';

const optionLabels: Record<DeliveryOption['type'], string> = {
  free: '🎁 ነፃ ማድረሻ / Free delivery',
  express: '🚚 ፈጣን / Express, today',
  saver: '🐢 ቁጠባ / Saver, next group run',
  pickup: '🏪 ከሱቁ መውሰድ / Pickup at the shop',
};

const pickupOnly: DeliveryOption = { type: 'pickup', fee: Money.zero, payout: Money.zero };

/** The message that offers the delivery options, one button per option. */
export function deliveryChoice(quote: DeliveryQuote | undefined): {
  text: string;
  buttons: Button[];
} {
  if (!quote) {
    return {
      text: 'ይህ ሱቅ ማድረሻ የለውም / This shop offers pickup only.',
      buttons: [optionButton(pickupOnly)],
    };
  }
  const distance = describeRoute(quote.route);
  const texts = {
    free: `🎉 ማድረሻው ነፃ ነው / Delivery to your location is free (${distance}).`,
    standard: `ማድረሻ / Delivery to your location (${distance}). Choose an option:`,
    far: `ከተለመደው የማድረሻ ክልል ውጭ ነዎት / You're outside our usual delivery area (${distance}). I can ask our drivers for a price, which takes about 10 minutes. Should I?`,
    beyond: `ይቅርታ፣ ቦታው ሩቅ ነው / Sorry, that is too far for delivery (${distance}). You can pick up at the shop.`,
  };
  const askDrivers = quote.area === 'far' ? [askDriversButton] : [];
  return {
    text: texts[quote.area],
    buttons: [...askDrivers, ...quote.options.map(optionButton)],
  };
}

const askDriversButton: Button = {
  text: '🛵 ዋጋ ጠይቅ / Yes, ask the drivers for a price',
  data: deliveryChoiceCallback('far'),
};

/** What Buchi says when it cannot use a location the customer sent. */
export function pinRequest(problem: PinProblem): string {
  return problem === 'outside_ethiopia'
    ? 'ይህ ቦታ ከኢትዮጵያ ውጭ ነው / That point is outside Ethiopia. Please send the delivery pin again.'
    : 'በሊንኩ ውስጥ ቦታ አላገኘሁም / I could not find a pin in that link. Please tap 📍 Share location, or drop a pin in Google Maps and share it.';
}

/** Paid options show their fee on the button. */
function optionButton(option: DeliveryOption): Button {
  const paid = option.type === 'express' || option.type === 'saver';
  const fee = paid ? ` · ${formatBirr(option.fee.toString())}` : '';
  return { text: `${optionLabels[option.type]}${fee}`, data: deliveryChoiceCallback(option.type) };
}

function describeRoute(route: Route): string {
  const kilometres = (route.meters / 1000).toFixed(1);
  if (route.approximate) return `about ${kilometres} km, estimated`;
  return `${kilometres} km by road, about ${String(Math.max(1, Math.round(route.seconds / 60)))} min`;
}
