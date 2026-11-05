/** Order references such as "#3F2A9C" contain digits that are not amounts. */
const ORDER_REFERENCE = /#[0-9A-Fa-f]{6}\b/g;
/** A number with optional thousands separators and decimals, such as 900, 4,500, or 4500.00. */
const NUMBER = /(?<![\d.])(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g;
const CURRENCY_AFTER = /^\s*(?:birr|br\b|etb|ብር)/i;
/**
 * Sizes, quantities, days, and hours stay below this. Smaller numbers count as prices only when a
 * currency follows them.
 */
const SMALLEST_UNMARKED_PRICE = 50;

/** One spelling per amount, so "4,500.00" and "4500" compare equal. */
function normalize(number: string): string {
  const plain = number.replaceAll(',', '');
  return plain.includes('.') ? plain.replace(/\.?0+$/, '') : plain;
}

/** Every number in a text, normalized. Used for the trusted texts a reply may quote from. */
export function numbersIn(text: string): string[] {
  return [...text.matchAll(NUMBER)].map((match) => normalize(match[0]));
}

/**
 * The amounts in a reply that no trusted source gave: not a tool result, not the shop context,
 * and not an earlier reply that passed this check. A customer's own numbers are not trusted, so
 * the agent cannot agree to a price that skipped the policy guard.
 */
export function unverifiedPrices(reply: string, trusted: Iterable<string>): string[] {
  const known = new Set(trusted);
  const text = reply.replace(ORDER_REFERENCE, '');
  return [...text.matchAll(NUMBER)]
    .filter((match) => {
      const followedByCurrency = CURRENCY_AFTER.test(text.slice(match.index + match[0].length));
      return followedByCurrency || Number(match[0].replaceAll(',', '')) >= SMALLEST_UNMARKED_PRICE;
    })
    .map((match) => normalize(match[0]))
    .filter((amount) => !known.has(amount));
}
