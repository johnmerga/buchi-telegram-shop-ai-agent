import { describe, expect, it } from 'vitest';
import { historyContents, replyLanguage, salesContext } from './conversation.domain';

describe('historyContents', () => {
  it('maps customer turns to user and Buchi turns to model', () => {
    expect(
      historyContents([
        { role: 'customer', text: 'Hi' },
        { role: 'buchi', text: 'Hello!' },
      ]),
    ).toEqual([
      { role: 'user', parts: [{ text: 'Hi' }] },
      { role: 'model', parts: [{ text: 'Hello!' }] },
    ]);
  });

  it('drops leading Buchi turns and merges neighbours of one role', () => {
    expect(
      historyContents([
        { role: 'buchi', text: 'Forgotten.' },
        { role: 'customer', text: 'Hi' },
        { role: 'customer', text: 'Anyone?' },
      ]),
    ).toEqual([{ role: 'user', parts: [{ text: 'Hi' }, { text: 'Anyone?' }] }]);
  });
});

describe('salesContext', () => {
  const boots = {
    productId: 'p1',
    title: 'Leather boots',
    pricingMode: 'negotiable' as const,
    price: '1000.00',
  };

  it('states the opened product and the agreed cart price as trusted prices', () => {
    const context = salesContext({
      opened: boots,
      cart: { variantId: 'v1', title: 'Leather boots', size: '40', price: '900.00' },
      facts: [{ key: 'shoe_size', fact: '40' }],
    });
    expect(context.text).toContain('negotiable, asking price 1000.00 birr');
    expect(context.text).toContain('size 40 (variantId v1, price 900.00 birr)');
    expect(context.text).toContain('Saved customer facts: shoe_size: 40');
    expect(context.prices).toEqual(['1000.00', '900.00']);
  });

  it('says when the cart is empty or its price is not agreed', () => {
    expect(salesContext({ opened: undefined, cart: undefined, facts: [] }).text).toContain(
      'Cart: empty',
    );
    const unpriced = salesContext({
      opened: { ...boots, pricingMode: 'fixed' },
      cart: { variantId: 'v1', title: 'Leather boots', size: '40', price: undefined },
      facts: [],
    });
    expect(unpriced.text).toContain('fixed price 1000.00 birr');
    expect(unpriced.text).toContain('price not agreed yet');
    expect(unpriced.prices).toEqual(['1000.00']);
  });
});

describe('replyLanguage', () => {
  it("asks for Amharic when the customer writes in Ge'ez script", () => {
    expect(replyLanguage('ዋጋው ስንት ነው?')).toBe('Reply in Amharic.');
  });

  it('asks for English when the customer writes only Latin letters', () => {
    expect(replyLanguage('How much are these boots?')).toBe('Reply in English.');
  });

  it('asks for the same mix when the message has both scripts', () => {
    expect(replyLanguage('How much is the ቀሚስ?')).toBe(
      'Reply in the same mix of Amharic and English.',
    );
  });

  it('asks for nothing when the message has no letters', () => {
    expect(replyLanguage('900? 👍')).toBeUndefined();
  });
});
