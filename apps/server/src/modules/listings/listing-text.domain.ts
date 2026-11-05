import { Money, type MoneyString, type PricingMode } from '@buchi/shared';

/** What the owner's own note fixes about a listing. The model never sets any of it. */
export interface OwnerNote {
  pricingMode: PricingMode;
  /** The fixed price, only when the note states one. A negotiable note never sets prices. */
  price: MoneyString | undefined;
  stockPerSize: number;
}

const NEGOTIABLE = /negotiable|nego\b|ድርድር|ይደራደራል|ዋጋ\s*በውስጥ|inbox/i;
/** "x3", "×3", or "3 each" sets the stock of every size. */
const STOCK = /(?:[x×]\s*(\d{1,3})\b)|(?:\b(\d{1,3})\s*(?:each|pcs|ጥንድ))/i;
/** A size range such as "40-44" is not a price. */
const RANGE = /\b\d{1,3}\s*[-–]\s*\d{1,3}\b/g;
const AMOUNT = /(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d,])/g;
const CURRENCY_AFTER = /^\s*(?:ብር|birr|br\b|etb)/i;
const CURRENCY_WORDS = /ብር|birr|br\b|etb/gi;
const PRICE_WORD = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;
/** Model numbers and sizes stay below this; a price without a currency word is at least this. */
const SMALLEST_UNMARKED_PRICE = 100;

/**
 * Reads the price, the pricing mode, and the stock from the owner's note, such as
 * "Nike Air 40-44 ጥቁር 3500". A number followed by ብር or birr is the price; otherwise the last
 * number of at least 100 that is not a size range or a stock count. A negotiable note has no
 * price here: Buchi asks for the asking and lowest prices in private.
 */
export function readOwnerNote(note: string): OwnerNote {
  const stock = STOCK.exec(note);
  const stockPerSize = Number(stock?.[1] ?? stock?.[2] ?? 1);
  if (NEGOTIABLE.test(note)) return { pricingMode: 'negotiable', price: undefined, stockPerSize };

  const text = note.replace(RANGE, ' ').replace(STOCK, ' ');
  const amounts = [...text.matchAll(AMOUNT)].map((match) => ({
    amount: amountOf(match),
    marked: CURRENCY_AFTER.test(text.slice(match.index + match[0].length)),
  }));
  const marked = amounts.filter((a) => a.marked);
  const unmarked = amounts.filter((a) => Number(a.amount) >= SMALLEST_UNMARKED_PRICE);
  const price = (marked.length > 0 ? marked : unmarked).at(-1)?.amount;
  return { pricingMode: 'fixed', price, stockPerSize };
}

/**
 * A reply that is only prices: one for a fixed price, or two for a negotiable product's asking
 * and lowest prices, in any order. Anything else is not a price reply.
 */
export function readPriceReply(reply: string): MoneyString[] | undefined {
  const words = reply
    .replace(CURRENCY_WORDS, ' ')
    .split(/[\s/]+/)
    .filter((word) => word !== '');
  const amounts = words.flatMap((word) => {
    const match = PRICE_WORD.exec(word);
    return match ? [amountOf(match)] : [];
  });
  if (amounts.length === 0 || amounts.length > 2 || amounts.length !== words.length) {
    return undefined;
  }
  return amounts.sort((a, b) => Money.of(b).compare(Money.of(a)));
}

function amountOf(match: RegExpMatchArray): MoneyString {
  const birr = (match[1] ?? '0').replaceAll(',', '');
  return match[2] ? `${birr}.${match[2]}` : birr;
}
