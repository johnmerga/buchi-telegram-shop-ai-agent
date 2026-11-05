import type { Api } from 'grammy';
import { productCard } from '../modules/catalog/catalog.domain';
import type { PhotoSearchAnswer } from '../modules/catalog/photo-search.service';
import type { ProductWithVariants } from '../modules/catalog/catalog.service';
import type { Coordinates } from '../modules/delivery/location.domain';
import { notifyCallbackData } from '../modules/demand/demand.schemas';
import type { CheckoutStep } from '../modules/orders/checkout.service';
import { inlineKeyboard, locationKeyboard, phoneKeyboard } from './keyboards';

/** A place the sales agent found for a landmark, for the customer to confirm. */
export interface PlaceCandidate {
  name: string;
  area: string;
  coordinates: Coordinates;
}

export const CONFIRM_PLACE_DATA = 'place:yes';

/**
 * Messages to a customer's private chat that come from code templates: product cards, the next
 * checkout step, and payment instructions. The button flow and the sales agent's tools share them,
 * so a model never writes a price, an account number, or a keyboard.
 */
export class TelegramCustomerChat {
  constructor(private readonly api: Api) {}

  async productCard(chatId: number, product: ProductWithVariants): Promise<void> {
    const { text, buttons } = productCard(product);
    const markup = buttons.length > 0 ? { reply_markup: inlineKeyboard(buttons) } : {};
    const photo = product.photoFileIds[0];
    if (photo) await this.api.sendPhoto(chatId, photo, { caption: text, ...markup });
    else await this.api.sendMessage(chatId, text, markup);
  }

  async orderStep(chatId: number, step: CheckoutStep): Promise<void> {
    switch (step.status) {
      case 'needs_phone':
        await this.api.sendMessage(
          chatId,
          'ትዕዛዙን ለመጨረስ ስልክ ቁጥርዎን ያጋሩ / Share your phone number to finish the order.',
          { reply_markup: phoneKeyboard() },
        );
        return;
      case 'needs_location':
        await this.askForPin(
          chatId,
          '📍 የት እናድርስ? / Where should we deliver? Share your location, or paste a Google Maps link.',
        );
        return;
      case 'placed':
        await this.api.sendMessage(chatId, step.instructions);
        return;
      case 'quoting':
        await this.api.sendMessage(
          chatId,
          '🛵 ሹፌሮቻችንን እየጠየቅሁ ነው / I am asking our drivers for a price. Your item is held for 20 minutes, and I will message you here in about 10 minutes.',
        );
    }
  }

  async askForPin(chatId: number, text: string): Promise<void> {
    await this.api.sendMessage(chatId, text, { reply_markup: locationKeyboard() });
  }

  /** The venue message carries the landmark, so the confirm button needs no stored state. */
  async confirmPlace(chatId: number, place: PlaceCandidate): Promise<void> {
    const { latitude, longitude } = place.coordinates;
    await this.api.sendVenue(chatId, latitude, longitude, place.name, place.area, {
      reply_markup: inlineKeyboard([
        { text: '✅ አዎ፣ ይህ ቦታ / Yes, this place', data: CONFIRM_PLACE_DATA },
      ]),
    });
    await this.askForPin(chatId, 'ትክክል ካልሆነ / Not right? Share the exact pin instead.');
  }

  async photoSearch(chatId: number, result: PhotoSearchAnswer): Promise<void> {
    if (result.status === 'not_found') {
      await this.api.sendMessage(
        chatId,
        'ይቅርታ፣ የሚመስል አላገኘንም / Sorry, we have nothing like it yet. Want a message when something similar arrives?',
        {
          reply_markup: inlineKeyboard([
            { text: '🔔 አሳውቀኝ / Notify me', data: notifyCallbackData(result.signalId) },
          ]),
        },
      );
      return;
    }
    await this.api.sendMessage(chatId, '🔎 ይህን የሚመስሉ አሉን / These look similar:');
    for (const product of result.products) await this.productCard(chatId, product);
  }
}
