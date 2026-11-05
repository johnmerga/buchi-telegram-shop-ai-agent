import type { Logger } from 'pino';
import { SIMILAR_PRODUCT_DISTANCE } from '../catalog/catalog.domain';
import type { CatalogService, ProductWithVariants } from '../catalog/catalog.service';
import type { CustomersService } from '../customers/customers.service';
import type { CustomerMessages } from '../operations/customer-messages.service';
import { WAITLIST_HOLD_MS } from '../orders/orders.deadlines.domain';
import type { OrderService } from '../orders/orders.service';
import type { ConversationService } from '../owner/conversations.service';
import type { DemandService } from './demand.service';
import { restockNotice, similarArrivedNotice } from './waitlist.domain';

interface ShopTimer {
  targetId: string;
  shopId: string | null;
}

type Customer = Awaited<ReturnType<CustomersService['get']>>;

/** The product card with its size buttons, which the purchase flow answers. */
interface ProductCards {
  productCard(chatId: number, product: ProductWithVariants): Promise<void>;
}

/**
 * Tells waiting customers about stock. When a waitlisted size is restocked, customers are told
 * in the order they joined, and each gets one unit held for 30 minutes through `OrderService`,
 * while units last. A hold that runs out frees its unit for the next customer in line. A new
 * product that looks like a customer's **Notify me** photo is shown to that customer, without a
 * hold, because the photo names no size.
 */
export class WaitlistNotifier {
  constructor(
    private readonly demand: Pick<
      DemandService,
      'waitingCustomers' | 'markNotified' | 'claimSimilarRequests'
    >,
    private readonly orders: Pick<OrderService, 'holdForCustomer' | 'releaseHold'>,
    private readonly catalog: Pick<CatalogService, 'activeProducts' | 'variantForSale'>,
    private readonly customers: Pick<CustomersService, 'get' | 'startSession'>,
    private readonly conversations: Pick<ConversationService, 'humanConversation'>,
    private readonly messages: Pick<CustomerMessages, 'toCustomer'>,
    private readonly chat: ProductCards,
    private readonly logger: Logger,
    private readonly now: () => Date,
  ) {}

  /** The `variant.restocked` subscriber. */
  async variantRestocked(event: { shopId: string; variantId: string }): Promise<void> {
    await this.offer(event.shopId, event.variantId);
  }

  /** The hold expiry timer. A unit the customer ordered is not released, and nobody is told. */
  async holdExpired(timer: ShopTimer): Promise<void> {
    if (timer.shopId === null) throw new Error('A stock hold timer needs a shop');
    const variantId = await this.orders.releaseHold(timer.shopId, timer.targetId);
    if (variantId) await this.offer(timer.shopId, variantId);
  }

  /** The `product.embedded` subscriber. */
  async productEmbedded(event: { shopId: string; productId: string; embedding: number[] }) {
    const { shopId, productId, embedding } = event;
    const [product] = await this.catalog.activeProducts(shopId, [productId]);
    if (!product?.variants.some((variant) => variant.stock > variant.reserved)) return;
    const customerIds = await this.demand.claimSimilarRequests(
      shopId,
      embedding,
      SIMILAR_PRODUCT_DISTANCE,
    );
    for (const customerId of customerIds) {
      const customer = await this.customers.get(shopId, customerId);
      await this.tell(shopId, customer, product, similarArrivedNotice(product.title));
    }
  }

  private async offer(shopId: string, variantId: string): Promise<void> {
    const forSale = await this.catalog.variantForSale(shopId, variantId);
    if (!forSale) return;
    const [product] = await this.catalog.activeProducts(shopId, [forSale.product.id]);
    if (!product) return;
    for (const customerId of await this.demand.waitingCustomers(shopId, variantId)) {
      const customer = await this.customers.get(shopId, customerId);
      // An owner is answering this customer, so Buchi neither writes nor holds; they keep their place.
      if (await this.conversations.humanConversation(shopId, customer.telegramUserId)) continue;
      const until = new Date(this.now().getTime() + WAITLIST_HOLD_MS);
      if (!(await this.orders.holdForCustomer(shopId, { variantId, customerId, until }))) return;
      await this.demand.markNotified(shopId, variantId, customerId);
      const notice = restockNotice({
        title: product.title,
        size: forSale.variant.size,
        heldUntil: until,
      });
      await this.tell(shopId, customer, product, notice);
    }
  }

  /**
   * The customer's chat moves to this shop and product, so the size buttons on the card work.
   * A customer who blocked the bot loses only their message; the hold runs out by itself.
   */
  private async tell(
    shopId: string,
    customer: Customer,
    product: ProductWithVariants,
    notice: string,
  ): Promise<void> {
    try {
      if ((await this.messages.toCustomer(shopId, customer, notice)) !== 'sent') return;
      await this.customers.startSession(customer.telegramUserId, shopId, product.id);
      await this.chat.productCard(customer.telegramUserId, product);
    } catch (err) {
      // Only the message: a Telegram error object also holds the request with its text.
      const reason = err instanceof Error ? err.message : 'unknown error';
      this.logger.warn(
        { shopId, customerId: customer.id, reason },
        'waitlist notice not delivered',
      );
    }
  }
}
