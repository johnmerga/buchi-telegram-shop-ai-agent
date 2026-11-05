import { describe, expect, it } from 'vitest';
import { restockNotice, similarArrivedNotice } from './waitlist.domain';

describe('waitlist notices', () => {
  it('names the size and how long it is held, in Addis Ababa time', () => {
    const text = restockNotice({
      title: 'Nike Air',
      size: '42',
      heldUntil: new Date('2026-11-05T14:30:00Z'),
    });
    expect(text).toContain('Nike Air · መጠን / size 42');
    expect(text).toContain('until 17:30');
  });

  it('names the product that arrived', () => {
    expect(similarArrivedNotice('White high-tops')).toContain('just arrived: White high-tops');
  });
});
