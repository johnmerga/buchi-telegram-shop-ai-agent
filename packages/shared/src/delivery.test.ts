import { describe, expect, it } from 'vitest';
import { deliverySettingsSchema } from './delivery';

const valid = {
  baseFee: '50',
  ratePerKm: '15',
  ratePerMinute: '2.50',
  freeRadiusKm: 3,
  standardRangeKm: 8,
  farRangeKm: 20,
  farCap: '1000',
  saverDiscountPercent: 20,
};

describe('deliverySettingsSchema', () => {
  it('accepts ranges that grow outwards, including equal ranges', () => {
    expect(deliverySettingsSchema.safeParse(valid).success).toBe(true);
    expect(
      deliverySettingsSchema.safeParse({ ...valid, freeRadiusKm: 8, farRangeKm: 8 }).success,
    ).toBe(true);
  });

  it('rejects a standard range inside the free radius', () => {
    const result = deliverySettingsSchema.safeParse({ ...valid, standardRangeKm: 2 });
    expect(result.error?.issues[0]?.path).toEqual(['standardRangeKm']);
  });

  it('rejects a far range inside the standard range', () => {
    const result = deliverySettingsSchema.safeParse({ ...valid, farRangeKm: 7 });
    expect(result.error?.issues[0]?.path).toEqual(['farRangeKm']);
  });

  it('rejects a fractional or too large Saver discount', () => {
    expect(deliverySettingsSchema.safeParse({ ...valid, saverDiscountPercent: 12.5 }).success).toBe(
      false,
    );
    expect(deliverySettingsSchema.safeParse({ ...valid, saverDiscountPercent: 95 }).success).toBe(
      false,
    );
  });
});
