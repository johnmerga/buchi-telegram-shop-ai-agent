import type { MoneyString, PricingMode } from '@buchi/shared';

/** A model turn as Gemini reads it, with text parts only. */
interface TextContent {
  role: 'user' | 'model';
  parts: { text: string }[];
}

/**
 * The remembered chat as model contents. Neighbouring turns of one role merge, and the contents
 * start with the customer, because Gemini expects the roles to alternate from a user turn.
 */
export function historyContents(
  turns: { role: 'customer' | 'buchi'; text: string }[],
): TextContent[] {
  const contents: TextContent[] = [];
  for (const turn of turns) {
    const role = turn.role === 'customer' ? 'user' : 'model';
    const last = contents.at(-1);
    if (last?.role === role) last.parts.push({ text: turn.text });
    else if (last || role === 'user') contents.push({ role, parts: [{ text: turn.text }] });
  }
  return contents;
}

interface ContextProduct {
  productId: string;
  title: string;
  pricingMode: PricingMode;
  price: MoneyString;
}

export interface SalesContextInput {
  opened: ContextProduct | undefined;
  cart:
    { variantId: string; title: string; size: string; price: MoneyString | undefined } | undefined;
  facts: { key: string; fact: string }[];
}

/**
 * The shop context that starts each customer turn, with the prices it states. Those prices come
 * from the database, so the reply may repeat them. Saved facts come from the customer, so their
 * numbers are not trusted as prices.
 */
export function salesContext(input: SalesContextInput): { text: string; prices: MoneyString[] } {
  const { opened, cart, facts } = input;
  const lines = ["[Shop context from Buchi's records, not from the customer]"];
  const prices: MoneyString[] = [];
  if (opened) {
    const priceText =
      opened.pricingMode === 'fixed'
        ? `fixed price ${opened.price} birr`
        : `negotiable, asking price ${opened.price} birr`;
    lines.push(
      `Product the customer opened: "${opened.title}" (productId ${opened.productId}, ${priceText})`,
    );
    prices.push(opened.price);
  }
  if (cart) {
    const priceText = cart.price ? `price ${cart.price} birr` : 'price not agreed yet';
    lines.push(
      `Cart: "${cart.title}" size ${cart.size} (variantId ${cart.variantId}, ${priceText})`,
    );
    if (cart.price) prices.push(cart.price);
  } else {
    lines.push('Cart: empty');
  }
  if (facts.length > 0) {
    lines.push(`Saved customer facts: ${facts.map((f) => `${f.key}: ${f.fact}`).join('; ')}`);
  }
  return { text: lines.join('\n'), prices };
}

/**
 * The reply language, read from the scripts in the customer's latest message. Product titles are
 * often Amharic, which pulls the model into Amharic when the prompt rule alone asks for English.
 */
export function replyLanguage(message: string): string | undefined {
  const amharic = /\p{Script=Ethiopic}/u.test(message);
  const english = /\p{Script=Latin}/u.test(message);
  if (amharic && english) return 'Reply in the same mix of Amharic and English.';
  if (amharic) return 'Reply in Amharic.';
  if (english) return 'Reply in English.';
  return undefined;
}
