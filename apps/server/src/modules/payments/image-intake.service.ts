import type { PhotoSearchAnswer, PhotoSearchService } from '../catalog/photo-search.service';
import type { CustomersService } from '../customers/customers.service';
import type { OrderService } from '../orders/orders.service';
import type { Button } from '../owner/owner.domain';
import type { MessageRef } from '../owner/owner-notifier.service';
import {
  alreadyChecking,
  noUnpaidOrder,
  orderClosed,
  otherImageReply,
  productPhotoReply,
} from './payment-messages.domain';
import type { PaymentVerification } from './payment-verification.service';
import type { ReceiptReader } from './receipt-reader.service';

/** Downloads a customer's image from Telegram as base64. Telegram is the only implementation. */
export interface ImageFiles {
  download(fileId: string): Promise<string>;
}

/** A text reply with its buttons, or the result of searching the catalog for a product photo. */
type IntakeReply =
  | { kind: 'text'; text: string; buttons: Button[] }
  | { kind: 'photo_search'; result: PhotoSearchAnswer };

export interface IncomingImage {
  fileId: string;
  mimeType: string;
  message: MessageRef;
}

/** Decides what a customer's image is for: paying an order, or something else. */
export class ImageIntake {
  constructor(
    private readonly files: ImageFiles,
    private readonly reader: Pick<ReceiptReader, 'classify'>,
    private readonly orders: Pick<OrderService, 'latestUnpaid' | 'latest'>,
    private readonly verification: Pick<PaymentVerification, 'verify'>,
    private readonly photos: Pick<PhotoSearchService, 'search'>,
    private readonly customers: Pick<CustomersService, 'byTelegramUser'>,
  ) {}

  async receive(
    shopId: string,
    telegramUserId: number,
    incoming: IncomingImage,
  ): Promise<IntakeReply> {
    const text = (reply: string): IntakeReply => ({ kind: 'text', text: reply, buttons: [] });
    const order = await this.orders.latestUnpaid(shopId, telegramUserId);
    const image = { mimeType: incoming.mimeType, data: await this.files.download(incoming.fileId) };
    const classification = await this.reader.classify(image);
    // Without the classifier, an image from a customer who owes a payment is most likely the
    // screenshot, so it goes on to verification, which sends it to the owner if it cannot read it.
    const kind = classification?.kind ?? (order ? 'receipt' : 'other');
    if (kind === 'product') return this.searchPhoto(shopId, telegramUserId, image);
    if (kind === 'other') return text(otherImageReply);
    if (!order) return text(await this.withoutUnpaidOrder(shopId, telegramUserId));
    if (order.status !== 'awaiting_payment') return text(alreadyChecking(order.id));
    const verified = await this.verification.verify(order, {
      kind: 'screenshot',
      fileId: incoming.fileId,
      message: incoming.message,
      image,
      classificationConfidence: classification?.confidence ?? null,
    });
    return { kind: 'text', ...verified };
  }

  /** A rejected payment is final, so its order takes no more screenshots. */
  private async withoutUnpaidOrder(shopId: string, telegramUserId: number): Promise<string> {
    const last = await this.orders.latest(shopId, telegramUserId);
    return last?.status === 'payment_rejected' ? orderClosed(last.id) : noUnpaidOrder;
  }

  /** Without the model, the customer still gets a polite reply that points to the channel. */
  private async searchPhoto(
    shopId: string,
    telegramUserId: number,
    image: { mimeType: string; data: string },
  ): Promise<IntakeReply> {
    const customer = await this.customers.byTelegramUser(shopId, telegramUserId);
    const result = await this.photos.search(shopId, customer.id, image);
    return result.status === 'unavailable'
      ? { kind: 'text', text: productPhotoReply, buttons: [] }
      : { kind: 'photo_search', result };
  }
}
