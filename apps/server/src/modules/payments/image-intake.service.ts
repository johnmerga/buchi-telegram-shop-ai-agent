import type { OrderService } from '../orders/orders.service';
import type { MessageRef } from '../owner/owner-notifier.service';
import {
  alreadyChecking,
  noUnpaidOrder,
  otherImageReply,
  productPhotoReply,
} from './payment-messages.domain';
import type { PaymentVerification } from './payment-verification.service';
import type { ReceiptReader } from './receipt-reader.service';

/** Downloads a customer's image from Telegram as base64. Telegram is the only implementation. */
export interface ImageFiles {
  download(fileId: string): Promise<string>;
}

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
    private readonly orders: Pick<OrderService, 'latestUnpaid'>,
    private readonly verification: Pick<PaymentVerification, 'verify'>,
  ) {}

  /** Returns the reply for the customer. */
  async receive(shopId: string, telegramUserId: number, incoming: IncomingImage): Promise<string> {
    const order = await this.orders.latestUnpaid(shopId, telegramUserId);
    const image = { mimeType: incoming.mimeType, data: await this.files.download(incoming.fileId) };
    const classification = await this.reader.classify(image);
    // Without the classifier, an image from a customer who owes a payment is most likely the
    // screenshot, so it goes on to verification, which sends it to the owner if it cannot read it.
    const kind = classification?.kind ?? (order ? 'receipt' : 'other');
    if (kind === 'product') return productPhotoReply;
    if (kind === 'other') return otherImageReply;
    if (!order) return noUnpaidOrder;
    if (order.status !== 'awaiting_payment') return alreadyChecking(order.id);
    return this.verification.verify(order, {
      fileId: incoming.fileId,
      message: incoming.message,
      image,
      classificationConfidence: classification?.confidence ?? null,
    });
  }
}
