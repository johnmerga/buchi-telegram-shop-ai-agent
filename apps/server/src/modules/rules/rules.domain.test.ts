import { Money } from '@buchi/shared';
import { describe, expect, it } from 'vitest';
import {
  matchesPromotion,
  pausePreview,
  promotedPrice,
  promotionPreview,
  resolveRule,
  settingsPreview,
} from './rules.domain';
import { ruleProposalSchema } from './rules.schemas';

/** Thursday 5 November 2026, 17:00 in Addis Ababa. */
const now = new Date('2026-11-05T14:00:00Z');

const proposal = (value: unknown) => ruleProposalSchema.parse(value);

describe('resolveRule', () => {
  it('pauses deliveries "ነገ ከ10 ሰዓት በኋላ" from 4:00 PM to the end of the day', () => {
    const rule = resolveRule(
      proposal({
        type: 'delivery_pause',
        deliveryPause: { date: '2026-11-06', from: { clock: 'ethiopian', hour: 10 } },
      }),
      now,
    );
    expect(rule).toMatchObject({
      type: 'delivery_pause',
      startsAt: new Date('2026-11-06T13:00:00Z'),
      endsAt: new Date('2026-11-06T21:00:00Z'),
    });
  });

  it('reads western times as given and a pause that ends on a later day', () => {
    const rule = resolveRule(
      proposal({
        type: 'delivery_pause',
        deliveryPause: {
          date: '2026-11-06',
          untilDate: '2026-11-07',
          until: { clock: 'western', hour: 9, minute: 30 },
        },
      }),
      now,
    );
    expect(rule.startsAt).toEqual(new Date('2026-11-05T21:00:00Z'));
    expect(rule.endsAt).toEqual(new Date('2026-11-07T06:30:00Z'));
  });

  it('puts a ሌሊት time after midnight on the next day', () => {
    const rule = resolveRule(
      proposal({
        type: 'delivery_pause',
        deliveryPause: {
          date: '2026-11-06',
          from: { clock: 'ethiopian', hour: 12, period: 'evening' },
          until: { clock: 'ethiopian', hour: 10, period: 'night' },
        },
      }),
      now,
    );
    expect(rule.startsAt).toEqual(new Date('2026-11-06T15:00:00Z'));
    expect(rule.endsAt).toEqual(new Date('2026-11-07T01:00:00Z'));
  });

  it('runs a promotion from the first day to the end of the last day', () => {
    const rule = resolveRule(
      proposal({
        type: 'promotion',
        promotion: {
          percentOff: 10,
          keywords: ['sneaker'],
          startDate: '2026-11-07',
          endDate: '2026-11-08',
        },
      }),
      now,
    );
    expect(rule).toEqual({
      type: 'promotion',
      startsAt: new Date('2026-11-06T21:00:00Z'),
      endsAt: new Date('2026-11-08T21:00:00Z'),
      parameters: { percentOff: 10, keywords: ['sneaker'] },
    });
  });

  it('starts a settings change now, with no end', () => {
    const rule = resolveRule(
      proposal({ type: 'delivery_settings', deliverySettings: { ratePerKm: '22' } }),
      now,
    );
    expect(rule).toEqual({
      type: 'delivery_settings',
      startsAt: now,
      endsAt: null,
      parameters: { ratePerKm: '22' },
    });
  });

  it('refuses a rule that is already over', () => {
    const over = proposal({
      type: 'delivery_pause',
      deliveryPause: { date: '2026-11-05', until: { clock: 'western', hour: 12 } },
    });
    expect(() => resolveRule(over, now)).toThrow('already be over');
  });
});

describe('ruleProposalSchema', () => {
  it('needs exactly the section of its type', () => {
    expect(ruleProposalSchema.safeParse({ type: 'promotion' }).success).toBe(false);
    expect(
      ruleProposalSchema.safeParse({
        type: 'delivery_settings',
        deliverySettings: { ratePerKm: '22' },
        deliveryPause: { date: '2026-11-06' },
      }).success,
    ).toBe(false);
  });

  it('rejects an Ethiopian hour above 12 and a period on the western clock', () => {
    const pause = (from: unknown) => ({
      type: 'delivery_pause',
      deliveryPause: { date: '2026-11-06', from },
    });
    expect(ruleProposalSchema.safeParse(pause({ clock: 'ethiopian', hour: 16 })).success).toBe(
      false,
    );
    expect(
      ruleProposalSchema.safeParse(pause({ clock: 'western', hour: 16, period: 'evening' }))
        .success,
    ).toBe(false);
  });

  it('rejects a period that ends before it starts', () => {
    expect(
      ruleProposalSchema.safeParse({
        type: 'promotion',
        promotion: { percentOff: 10, keywords: [], startDate: '2026-11-08', endDate: '2026-11-07' },
      }).success,
    ).toBe(false);
    expect(
      ruleProposalSchema.safeParse({
        type: 'delivery_pause',
        deliveryPause: {
          date: '2026-11-06',
          from: { clock: 'ethiopian', hour: 10 },
          until: { clock: 'western', hour: 9 },
        },
      }).success,
    ).toBe(false);
  });

  it('rejects an empty settings change', () => {
    expect(
      ruleProposalSchema.safeParse({ type: 'delivery_settings', deliverySettings: {} }).success,
    ).toBe(false);
  });
});

const sneaker = {
  title: 'Nike Air sneaker',
  description: 'Black',
  pricingMode: 'fixed' as const,
  price: Money.of('3499'),
};

describe('promotedPrice', () => {
  it('takes the percentage off and rounds the discount up to whole birr', () => {
    expect(promotedPrice(sneaker, [{ percentOff: 10, keywords: ['SNEAKER'] }]).toString()).toBe(
      '3149.00',
    );
  });

  it('applies only the largest of overlapping promotions', () => {
    const price = promotedPrice(sneaker, [
      { percentOff: 10, keywords: [] },
      { percentOff: 20, keywords: ['nike'] },
    ]);
    expect(price.toString()).toBe('2799.00');
  });

  it('keeps the price when no promotion matches', () => {
    expect(promotedPrice(sneaker, [{ percentOff: 10, keywords: ['boot'] }])).toBe(sneaker.price);
  });

  it('never touches a negotiable product', () => {
    const negotiable = { ...sneaker, pricingMode: 'negotiable' as const };
    expect(promotedPrice(negotiable, [{ percentOff: 50, keywords: [] }])).toBe(negotiable.price);
    expect(matchesPromotion(negotiable, { percentOff: 50, keywords: [] })).toBe(false);
  });
});

describe('previews', () => {
  it('shows a pause in both clocks', () => {
    const text = pausePreview({
      startsAt: new Date('2026-11-06T13:00:00Z'),
      endsAt: new Date('2026-11-06T21:00:00Z'),
    });
    expect(text).toContain('From: Fri 6 Nov, 16:00 (ከቀኑ 10 ሰዓት)');
    expect(text).toContain('Until: Sat 7 Nov, 00:00 (ከሌሊቱ 6 ሰዓት)');
  });

  it('shows the promotion, its last day, and the products it matches now', () => {
    const text = promotionPreview(
      {
        startsAt: new Date('2026-11-06T21:00:00Z'),
        endsAt: new Date('2026-11-08T21:00:00Z'),
        parameters: { percentOff: 10, keywords: ['sneaker'] },
      },
      ['Nike Air', 'Adidas Samba'],
    );
    expect(text).toContain('10% off fixed-price products with "sneaker"');
    expect(text).toContain('From Sat 7 Nov to Sun 8 Nov');
    expect(text).toContain('Matches now: 2 (Nike Air, Adidas Samba)');
  });

  it('shows each changed setting with its current value', () => {
    const current = {
      baseFee: '50.00',
      ratePerKm: '18.00',
      ratePerMinute: '2.00',
      freeRadiusKm: 3,
      standardRangeKm: 8,
      farRangeKm: 20,
      farCap: '1000.00',
      saverDiscountPercent: 20,
    };
    const text = settingsPreview(current, { ratePerKm: '22', freeRadiusKm: 2 });
    expect(text).toContain('Rate per km: 18.00 ብር → 22.00 ብር');
    expect(text).toContain('Free radius (km): 3 → 2');
    expect(settingsPreview(undefined, { ratePerKm: '22' })).toContain('Rate per km: 22.00 ብር');
  });
});
