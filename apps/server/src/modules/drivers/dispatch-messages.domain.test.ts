import { describe, expect, it } from 'vitest';
import {
  availabilityText,
  deliveredReply,
  jobDetails,
  offerText,
  onTheWay,
  readyForPickup,
} from './dispatch-messages.domain';

const orderId = '3f2a9c00-0000-4000-8000-000000000001';
const pin = { latitude: 8.99706, longitude: 38.78661 };

describe('offerText', () => {
  const offer = {
    special: false,
    shopName: 'Selam Shoes',
    stops: 1,
    routeMeters: 6240,
    estimatedMinutes: 18,
    price: '125.00',
    raiseStep: 0,
  };

  it('shows the trip and the payout without any customer detail', () => {
    expect(offerText(offer)).toBe(
      [
        '🛵 አዲስ ስራ / New delivery job · Selam Shoes',
        '1 stop · ~6.2 km · ~18 min',
        'ክፍያ / Payout: 125.00 ብር',
      ].join('\n'),
    );
  });

  it('counts the stops of a route and marks a raised payout', () => {
    const text = offerText({ ...offer, stops: 4, raiseStep: 1, price: '155.00' });
    expect(text).toContain('4 stops');
    expect(text).toContain('155.00 ብር (bonus included)');
  });

  it('marks a far-area job as a special offer that only holds until payment', () => {
    const text = offerText({ ...offer, special: true, raiseStep: 2, price: '480.00' });
    expect(text).toContain('Special offer · Selam Shoes');
    expect(text).toContain('480.00 ብር (raised)');
    expect(text).toContain('once the customer confirms and pays');
  });
});

describe('jobDetails', () => {
  const stop = {
    position: 1,
    orderId,
    customerName: 'Hana',
    phone: '+251911000001',
    pin,
    lines: [{ title: 'Nike Air', size: '42', quantity: 2 }],
  };

  it('lists each stop with its customer, phone, pin, and items', () => {
    const text = jobDetails({ shopName: 'Selam', shopPin: pin, payout: '125.00', stops: [stop] });
    expect(text).toContain('Pick up at Selam https://www.google.com/maps?q=8.99706,38.78661');
    expect(text).toContain('1. Hana · #3F2A9C');
    expect(text).toContain('📞 +251911000001');
    expect(text).toContain('Nike Air · 42 × 2');
  });

  it('works without a shop pin or a customer phone', () => {
    const text = jobDetails({
      shopName: 'Selam',
      shopPin: null,
      payout: '125.00',
      stops: [{ ...stop, phone: null, lines: [{ title: 'Cap', size: 'M', quantity: 1 }] }],
    });
    expect(text).toContain('Pick up at Selam\n');
    expect(text).toContain('📞 no phone');
    expect(text).toContain('Cap · M\n');
  });
});

describe('onTheWay', () => {
  it("names the driver and gives the driver's phone", () => {
    expect(onTheWay(orderId, { name: 'Abebe', phone: '+251911000001' })).toContain(
      'Driver: Abebe · 📞 +251911000001',
    );
  });

  it('names the driver without a phone', () => {
    expect(onTheWay(orderId, { name: 'Abebe', phone: null })).toMatch(/Driver: Abebe$/);
  });
});

describe('deliveredReply', () => {
  it('sends the driver to the next stop until the job is complete', () => {
    expect(deliveredReply(orderId, false)).toContain('On to the next stop');
    expect(deliveredReply(orderId, true)).toContain('The job is complete');
  });
});

describe('readyForPickup', () => {
  it('links the shop pin when the shop has one', () => {
    expect(readyForPickup(orderId, { name: 'Selam', pin })).toContain('📍 https://www.google.com');
    expect(readyForPickup(orderId, { name: 'Selam', pin: null })).not.toContain('📍');
  });
});

describe('availabilityText', () => {
  it('says whether new jobs will come', () => {
    expect(availabilityText(true)).toContain('You are available');
    expect(availabilityText(false)).toContain('You are off duty');
  });
});
