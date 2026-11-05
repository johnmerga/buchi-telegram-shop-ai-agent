import type { OperationsAgent } from '../../ai/agents/operations/operations-agent';
import type { SituationBuilder } from '../../ai/agents/operations/situation-builder';
import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import { AppError } from '../../shared/errors';
import type { CatalogService } from '../catalog/catalog.service';
import type { CustomersService } from '../customers/customers.service';
import type { OrderService, OrderWithItems } from '../orders/orders.service';
import type { ConversationService } from '../owner/conversations.service';
import type { Messenger } from '../owner/owner-notifier.service';
import type { DeliveryProblemsRepo } from './delivery-problems.repo';
import { problemForOwner, problemQuestion } from './operations.domain';
import { problemCallbackData, type ProblemKind } from './operations.schemas';

export type ReportResult =
  | { status: 'recorded'; shopId: string }
  | { status: 'ask_size'; sizes: string[] }
  | { status: 'already_reported' }
  | { status: 'not_found' };

export type SizeResult =
  { status: 'recorded'; shopId: string } | { status: 'already_reported' | 'not_found' };

/**
 * A customer's **Problem** after a delivery: code asks what is wrong, and for a wrong size which
 * size they need, and then the operations agent takes the case. Each step counts once per order.
 */
export class CustomerProblems {
  constructor(
    private readonly db: Database,
    private readonly repo: DeliveryProblemsRepo,
    private readonly orders: Pick<OrderService, 'get' | 'getForCustomer'>,
    private readonly customers: Pick<CustomersService, 'telegramUserId'>,
    private readonly catalog: Pick<CatalogService, 'variantForSale' | 'activeProducts'>,
    private readonly messenger: Pick<Messenger, 'send'>,
    private readonly conversations: Pick<
      ConversationService,
      'humanConversation' | 'relayFromCustomer'
    >,
    private readonly situations: Pick<SituationBuilder, 'deliveryProblem'>,
    private readonly agent: Pick<OperationsAgent, 'handle'>,
  ) {}

  /**
   * The `delivery.problem_reported` subscriber: asks the customer what is wrong. While an owner
   * answers the customer, the report goes to the owner instead.
   */
  async problemReported(event: { shopId: string; orderId: string }): Promise<void> {
    const { shopId, orderId } = event;
    const order = await this.orders.get(shopId, orderId);
    const chatId = await this.customers.telegramUserId(shopId, order.customerId);
    const ownerChat = await this.conversations.humanConversation(shopId, chatId);
    if (ownerChat) {
      await this.conversations.relayFromCustomer(ownerChat, { text: problemForOwner(orderId) });
      return;
    }
    await this.messenger.send(chatId, problemQuestion(orderId), [
      { text: '📏 Wrong size / መጠኑ አልሆነም', data: problemCallbackData('wrong_size', orderId) },
      { text: '💔 Damaged / ተበላሽቷል', data: problemCallbackData('damaged', orderId) },
      { text: '❓ Other / ሌላ', data: problemCallbackData('other', orderId) },
    ]);
  }

  /** Records what is wrong. A wrong size asks for the size first, unless there is no other. */
  async report(telegramUserId: number, orderId: string, kind: ProblemKind): Promise<ReportResult> {
    const order = await this.deliveredOrder(telegramUserId, orderId);
    if (!order) return { status: 'not_found' };
    const { shopId } = order;
    const recorded = await withShop(this.db, shopId, (tx) =>
      this.repo.insert(tx, { shopId, orderId, kind }),
    );
    if (!recorded) return { status: 'already_reported' };
    const sizes = kind === 'wrong_size' ? await this.otherSizes(order) : [];
    return sizes.length > 0 ? { status: 'ask_size', sizes } : { status: 'recorded', shopId };
  }

  async chooseSize(telegramUserId: number, orderId: string, size: string): Promise<SizeResult> {
    const order = await this.deliveredOrder(telegramUserId, orderId);
    if (!order) return { status: 'not_found' };
    const chosen = await withShop(this.db, order.shopId, (tx) =>
      this.repo.setWantedSize(tx, orderId, size),
    );
    return chosen ? { status: 'recorded', shopId: order.shopId } : { status: 'already_reported' };
  }

  /** Hands the recorded problem to the operations agent. */
  async resolve(
    shopId: string,
    orderId: string,
    kind: ProblemKind,
    wantedSize: string | undefined,
  ): Promise<void> {
    await this.agent.handle(
      await this.situations.deliveryProblem(shopId, orderId, kind, wantedSize),
    );
  }

  private async deliveredOrder(
    telegramUserId: number,
    orderId: string,
  ): Promise<OrderWithItems | undefined> {
    try {
      const order = await this.orders.getForCustomer(telegramUserId, orderId);
      return order.status === 'delivered' ? order : undefined;
    } catch (err) {
      if (err instanceof AppError && err.code === 'NOT_FOUND') return undefined;
      throw err;
    }
  }

  /** The sizes of the order's products that the customer did not get. */
  private async otherSizes(order: OrderWithItems): Promise<string[]> {
    const items = await Promise.all(
      order.items.map((item) => this.catalog.variantForSale(order.shopId, item.variantId)),
    );
    const bought = new Set(items.flatMap((found) => (found ? [found.variant.size] : [])));
    const productIds = [...new Set(items.flatMap((found) => (found ? [found.product.id] : [])))];
    const products = await this.catalog.activeProducts(order.shopId, productIds);
    const sizes = products.flatMap((product) => product.variants.map((variant) => variant.size));
    return [...new Set(sizes)].filter((size) => !bought.has(size));
  }
}
