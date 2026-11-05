import type { Coordinates } from '../modules/delivery/location.domain';

/**
 * Links that open the customer Mini App from a chat button. Telegram opens only HTTPS links, so
 * without a public web app URL the chat offers the plain location button alone.
 */
export class MiniAppLinks {
  constructor(private readonly baseUrl: string) {}

  /** The map picker starts at `suggested`, such as a landmark the customer named. */
  pinPicker(suggested?: Coordinates): string {
    const url = new URL('/customer/pin', this.baseUrl);
    if (suggested) {
      url.searchParams.set('lat', String(suggested.latitude));
      url.searchParams.set('lng', String(suggested.longitude));
    }
    return url.toString();
  }

  orderTracking(orderId: string): string {
    return new URL(`/customer/orders/${orderId}`, this.baseUrl).toString();
  }
}
