import { describe, expect, it } from 'vitest';
import {
  availableSizes,
  buyLink,
  formatBirr,
  postContent,
  postIdFromStartPayload,
} from './catalog.domain';

describe('formatBirr', () => {
  it('groups thousands and keeps two decimals', () => {
    expect(formatBirr('3500')).toBe('3,500.00 ብር');
    expect(formatBirr('1234567.5')).toBe('1,234,567.50 ብር');
    expect(formatBirr('99.99')).toBe('99.99 ብር');
  });
});

describe('availableSizes', () => {
  it('lists sizes with unreserved stock in natural order, once each', () => {
    expect(
      availableSizes([
        { size: '42', stock: 2, reserved: 0 },
        { size: '40', stock: 1, reserved: 0 },
        { size: '41', stock: 1, reserved: 1 },
        { size: '40', stock: 3, reserved: 0 },
        { size: '9', stock: 1, reserved: 0 },
      ]),
    ).toEqual(['9', '40', '42']);
  });
});

describe('postContent', () => {
  const base = { title: 'Nike Air', description: 'Black, original' };

  it('shows the price of a fixed-price product with a Buy button', () => {
    const post = postContent({ ...base, pricingMode: 'fixed', price: '3500' }, ['40', '41']);
    expect(post.caption).toContain('3,500.00 ብር');
    expect(post.caption).toContain('40, 41');
    expect(post.buttonText).toContain('Buy');
  });

  it('never shows the price of a negotiable product', () => {
    const post = postContent({ ...base, pricingMode: 'negotiable', price: '3500' }, ['40']);
    expect(post.caption).not.toContain('3,500');
    expect(post.buttonText).toContain('Ask price');
  });

  it('skips an empty description', () => {
    const post = postContent({ ...base, description: '', pricingMode: 'fixed', price: '1' }, ['M']);
    expect(post.caption).not.toContain('\n\n\n');
  });
});

describe('start payloads', () => {
  const postId = '0f8fad5b-d9cb-469f-a165-70867728950e';

  it('round-trips a post ID through the Buy link', () => {
    const link = buyLink('buchi_bot', postId);
    const payload = link.split('start=')[1] ?? '';
    expect(payload.length).toBeLessThanOrEqual(64);
    expect(postIdFromStartPayload(payload)).toBe(postId);
  });

  it('ignores other payloads', () => {
    expect(postIdFromStartPayload('drv_abc')).toBeUndefined();
    expect(postIdFromStartPayload('p_not-a-uuid')).toBeUndefined();
  });
});
