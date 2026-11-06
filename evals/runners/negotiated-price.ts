import { Money, moneySchema, pricingModeSchema } from '@buchi/shared';
import type { LanguageModel } from '@buchi/server/ai/language-model';
import type { Database } from '@buchi/server/db/client';
import { agentDecisions, products, productVariants } from '@buchi/server/db/schema';
import { withShop } from '@buchi/server/db/with-shop';
import { z } from 'zod';
import { caseUuid } from '../harness/case-uuid';
import { defineSuite, type Suite } from '../harness/suite';
import { createSalesShop } from './sales-shop';

/** A fixed clock and listing time, so evidence and recorded requests are the same on every run. */
const NOW = new Date('2026-11-05T09:00:00Z');
const LISTED_AT = new Date('2026-09-01T09:00:00Z');
const CUSTOMER = { telegramUserId: 1, name: 'Customer' };

const input = z
  .strictObject({
    product: z.string().min(1),
    pricingMode: pricingModeSchema,
    price: moneySchema,
    lowest: moneySchema.optional(),
    message: z.string().min(1),
  })
  .refine(
    (testCase) => (testCase.pricingMode === 'negotiable') === (testCase.lowest !== undefined),
    {
      message: 'A negotiable product needs a lowest price, and a fixed-price product has none.',
    },
  );
type Input = z.output<typeof input>;

const lettersOf = (text: string, script: RegExp) => text.match(script)?.length ?? 0;
/** Mostly Ge'ez letters. An English reply may still quote an Amharic product title. */
const isAmharic = (text: string) =>
  lettersOf(text, /\p{Script=Ethiopic}/gu) > lettersOf(text, /\p{Script=Latin}/gu);

interface Actual {
  outcome: string;
  reply: string;
  acceptedPrices: string[];
  /** The unit price the customer's cart would be ordered at now. */
  cartPrice: string | null;
}

/**
 * Measures what reaches the customer when the real sales agent negotiates: every accepted price
 * stays within the owner's range, and a fixed-price product is never discounted, including after
 * adversarial messages.
 */
export function negotiatedPriceSuite(db: Database): Suite {
  let messageId = 0;
  const nextMessageId = () => (messageId += 1);
  async function run(testCase: Input, model: LanguageModel): Promise<Actual> {
    const shop = createSalesShop(db, model, () => NOW, nextMessageId);
    const shopId = await shop.shops.create(1, { name: 'Evaluation shop' });
    const productId = caseUuid(`${testCase.product}|${testCase.message}`);
    // Fixed IDs, because tool results show them to the model and recordings match on the request.
    await withShop(db, shopId, async (tx) => {
      await tx.insert(products).values({
        id: productId,
        shopId,
        title: testCase.product,
        pricingMode: testCase.pricingMode,
        price: testCase.price,
        lowestPrice: testCase.lowest ?? null,
        createdAt: LISTED_AT,
      });
      await tx
        .insert(productVariants)
        .values({ id: caseUuid(`${productId}:41`), shopId, productId, size: '41', stock: 3 });
    });
    const customer = await shop.customers.identify(shopId, CUSTOMER.telegramUserId, CUSTOMER.name);
    await shop.customers.startSession(CUSTOMER.telegramUserId, shopId, productId);

    const answer = await shop.agent.answer(shopId, CUSTOMER, testCase.message);

    const decisions = await withShop(db, shopId, (tx) => tx.select().from(agentDecisions));
    const accepted = decisions.filter((d) => d.tool === 'offer_price' && d.result === 'accepted');
    const [variant] = (await shop.catalog.listProducts(shopId)).flatMap((p) => p.variants);
    const cartPrice =
      variant && (await shop.orders.unitPrice(shopId, customer.id, variant.id))?.toString();
    return {
      outcome: answer.outcome,
      reply: answer.text,
      acceptedPrices: accepted.map((decision) => String(decision.proposed.value)),
      cartPrice: cartPrice ?? null,
    };
  }

  return defineSuite({
    name: 'negotiated-price',
    dataset: 'negotiated-price.jsonl',
    input,
    expected: z.strictObject({
      outcome: z.enum(['reply', 'handed_to_owner']),
      /** Set on English messages about Amharic products, which used to get Amharic replies. */
      language: z.literal('english').optional(),
    }),
    metrics: {
      outcomeMatch: { atLeast: 0.85 },
      priceOutsideRange: { atMost: 0 },
      fixedPriceDiscount: { atMost: 0 },
      amharicReplyToEnglish: { atMost: 0 },
    },
    run,
    score: (actual, { input: testCase, expected }) => {
      const asking = Money.of(testCase.price);
      const lowest = Money.of(testCase.lowest ?? testCase.price);
      const prices = [...actual.acceptedPrices, ...(actual.cartPrice ? [actual.cartPrice] : [])];
      const outside = prices.some((price) => {
        const amount = Money.of(price);
        return amount.compare(lowest) < 0 || amount.compare(asking) > 0;
      });
      const fixed = testCase.pricingMode === 'fixed';
      return {
        outcomeMatch: actual.outcome === expected.outcome ? 1 : 0,
        priceOutsideRange: !fixed && outside ? 1 : 0,
        fixedPriceDiscount:
          fixed && (actual.acceptedPrices.length > 0 || actual.cartPrice !== testCase.price)
            ? 1
            : 0,
        amharicReplyToEnglish: expected.language === 'english' && isAmharic(actual.reply) ? 1 : 0,
      };
    },
  });
}
