import { Money } from '@buchi/shared';
import { describe, expect, it } from 'vitest';
import type { DeliveryQuote } from '../delivery/fees.domain';
import { deliveryChoice, pinRequest } from './delivery-choice.domain';

const pickup = { type: 'pickup' as const, fee: Money.zero, payout: Money.zero };
const route = { meters: 5240, seconds: 870, approximate: false };

describe('deliveryChoice', () => {
  it('offers Express and Saver with their fees, and pickup', () => {
    const quote: DeliveryQuote = {
      area: 'standard',
      route,
      options: [
        { type: 'express', fee: Money.of('160'), payout: Money.of('155') },
        { type: 'saver', fee: Money.of('120'), payout: Money.of('155') },
        pickup,
      ],
    };
    const { text, buttons } = deliveryChoice(quote);
    expect(text).toContain('5.2 km by road, about 15 min');
    expect(buttons).toEqual([
      { text: '🚚 ፈጣን / Express, today · 160.00 ብር', data: 'deliver:express' },
      { text: '🐢 ቁጠባ / Saver, next group run · 120.00 ብር', data: 'deliver:saver' },
      { text: '🏪 ከሱቁ መውሰድ / Pickup at the shop', data: 'deliver:pickup' },
    ]);
  });

  it('says when delivery is free', () => {
    const { text, buttons } = deliveryChoice({
      area: 'free',
      route,
      options: [{ type: 'free', fee: Money.zero, payout: Money.of('90') }, pickup],
    });
    expect(text).toContain('free');
    expect(buttons.map((b) => b.data)).toEqual(['deliver:free', 'deliver:pickup']);
  });

  it('marks a straight-line distance as an estimate', () => {
    const { text } = deliveryChoice({
      area: 'free',
      route: { ...route, approximate: true },
      options: [pickup],
    });
    expect(text).toContain('about 5.2 km, estimated');
  });

  it('explains the far range and the range beyond it, offering pickup', () => {
    const far = deliveryChoice({ area: 'far', route, options: [pickup] });
    expect(far.text).toContain('outside our usual delivery area');
    const beyond = deliveryChoice({ area: 'beyond', route, options: [pickup] });
    expect(beyond.text).toContain('too far for delivery');
    expect(beyond.buttons.map((b) => b.data)).toEqual(['deliver:pickup']);
  });

  it('offers pickup when the shop does not deliver', () => {
    const { text, buttons } = deliveryChoice(undefined);
    expect(text).toContain('pickup only');
    expect(buttons.map((b) => b.data)).toEqual(['deliver:pickup']);
  });
});

describe('pinRequest', () => {
  it('asks for a pin in a way that fits the problem', () => {
    expect(pinRequest('no_coordinates')).toContain('could not find a pin');
    expect(pinRequest('outside_ethiopia')).toContain('outside Ethiopia');
  });
});
