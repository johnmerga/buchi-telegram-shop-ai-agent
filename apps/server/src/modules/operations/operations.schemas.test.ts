import { describe, expect, it } from 'vitest';
import {
  problemCallbackData,
  problemCallbackSchema,
  wantedSizeCallbackData,
  wantedSizeCallbackSchema,
} from './operations.schemas';

const orderId = '3f2a9c00-0000-4000-8000-000000000001';

describe('problem buttons', () => {
  it('read back the kind and the order', () => {
    expect(problemCallbackSchema.parse(problemCallbackData('damaged', orderId))).toMatchObject({
      kind: 'damaged',
      orderId,
    });
    expect(problemCallbackSchema.safeParse(`problem:lost:${orderId}`).success).toBe(false);
  });
});

describe('size buttons', () => {
  it('read back the order and a size, even one with a colon', () => {
    const data = wantedSizeCallbackData(orderId, 'EU:43');
    expect(wantedSizeCallbackSchema.parse(data)).toMatchObject({ orderId, size: 'EU:43' });
  });

  it('leave out a size that would not fit in 64 bytes', () => {
    expect(wantedSizeCallbackData(orderId, 'ትልቅ መጠን ያለው')).toBeUndefined();
  });
});
