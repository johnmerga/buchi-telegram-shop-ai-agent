import { describe, expect, it } from 'vitest';
import {
  noPrice,
  ownerApproval,
  pickupButton,
  pickupOffered,
  priceFound,
} from './far-quote-messages.domain';

const orderId = '3f2a9c00-0000-4000-8000-000000000001';

describe('far quote messages', () => {
  it('shows the customer the held delivery fee and the new total', () => {
    const text = priceFound({ orderId, itemsTotal: '3500.00', fee: '420.00', total: '3920.00' });
    expect(text).toContain('#3F2A9C');
    expect(text).toContain('Delivery: 420.00 ብር');
    expect(text).toContain('Total: 3,920.00 ብር');
  });

  it('says why the quote ended without a price', () => {
    expect(noPrice(orderId, false)).toContain('No driver took the delivery within 20 minutes');
    expect(noPrice(orderId, true)).toContain('was not confirmed within 20 minutes');
    expect(pickupOffered(orderId)).toContain('pick it up at the shop');
    expect(pickupButton.data).toBe('deliver:pickup');
  });

  it('gives the owner the price, the cap, the payout, and the reason', () => {
    const text = ownerApproval({
      orderId,
      routeMeters: 18_400,
      formulaPayout: '420.00',
      cap: '1000.00',
      price: '1200.00',
      reason: 'The road to Kality is closed.',
    });
    expect(text).toContain('(18.4 km)');
    expect(text).toContain('1,200.00 ብር, above your cap of 1,000.00 ብር');
    expect(text).toContain('Why: The road to Kality is closed.');
  });
});
