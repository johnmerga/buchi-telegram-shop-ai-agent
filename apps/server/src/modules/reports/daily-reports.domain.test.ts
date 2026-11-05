import { describe, expect, it } from 'vitest';
import { eveningSummaryText, morningBriefText } from './daily-reports.domain';

describe('eveningSummaryText', () => {
  it('reports the day in both languages with birr amounts', () => {
    const text = eveningSummaryText({
      day: '2026-11-05',
      ordersCreated: 7,
      ordersPaid: 5,
      revenue: '17500',
      deliveryCost: '450.5',
      saverSavings: '120',
      fraudBlocked: 1,
      fraudBlockedAmount: '3500',
      openReviews: 2,
    });
    expect(text).toBe(
      [
        '🌇 የዕለቱ ማጠቃለያ / Evening summary · 2026-11-05',
        '🛒 ትዕዛዞች / Orders: 7 · ተከፍሏል / paid: 5',
        '💰 ገቢ / Revenue: 17,500.00 ብር',
        '🛵 የማድረሻ ወጪ / Delivery cost: 450.50 ብር',
        '💡 Saver ቁጠባ / Saver savings: 120.00 ብር',
        '🛡️ የታገዱ ማጭበርበሮች / Fraud blocked: 1 (3,500.00 ብር)',
        '⏳ ግምገማ የሚጠብቁ / Open reviews: 2',
      ].join('\n'),
    );
  });
});

describe('morningBriefText', () => {
  it('lists low stock, marks sold-out sizes, and lists the waitlist', () => {
    const text = morningBriefText({
      lowStock: [
        { title: 'Nike Air', size: '42', available: 0 },
        { title: 'Nike Air', size: '43', available: 2 },
      ],
      openReviews: 1,
      waitlist: [{ title: 'Nike Air', size: '42', waiting: 3 }],
      notifyRequests: 4,
    });
    expect(text).toContain('• Nike Air · 42: 0 ቀርቷል / left ⚠️');
    expect(text).toContain('• Nike Air · 43: 2 ቀርቷል / left\n');
    expect(text).toContain('⏳ ግምገማ የሚጠብቁ / Open reviews: 1');
    expect(text).toContain('• Nike Air · 42: 3 ሰው / waiting');
    expect(text).toContain('Notify-me requests (7 days): 4');
  });

  it('says so when nothing is low and nobody waits', () => {
    const text = morningBriefText({
      lowStock: [],
      openReviews: 0,
      waitlist: [],
      notifyRequests: 0,
    });
    expect(text).toContain('Every size is in stock');
    expect(text).toContain('Nobody is waiting');
  });

  it('shortens a long list and says how many it left out', () => {
    const lowStock = Array.from({ length: 10 }, (_, i) => ({
      title: 'Sandal',
      size: String(36 + i),
      available: 1,
    }));
    const text = morningBriefText({ lowStock, openReviews: 0, waitlist: [], notifyRequests: 0 });
    expect(text).toContain('• Sandal · 43: 1');
    expect(text).not.toContain('• Sandal · 44');
    expect(text).toContain('… +2');
  });
});
