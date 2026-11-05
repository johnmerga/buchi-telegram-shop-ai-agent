import { InlineKeyboard, Keyboard } from 'grammy';
import type { Button } from '../modules/owner/owner.domain';

export function inlineKeyboard(buttons: Button[]): InlineKeyboard {
  return InlineKeyboard.from([
    buttons.map((button) => InlineKeyboard.text(button.text, button.data)),
  ]);
}

export function oneButtonPerRow(buttons: Button[]): InlineKeyboard {
  return InlineKeyboard.from(
    buttons.map((button) => [InlineKeyboard.text(button.text, button.data)]),
  );
}

/** The text of the pickup button under the location request, which the purchase flow matches. */
export const PICKUP_TEXT = '🏪 ከሱቁ እወስዳለሁ / I will pick up at the shop';

export function locationKeyboard(): Keyboard {
  return new Keyboard()
    .requestLocation('📍 ቦታ አጋራ / Share location')
    .row()
    .text(PICKUP_TEXT)
    .oneTime()
    .resized();
}

export function phoneKeyboard(): Keyboard {
  return new Keyboard().requestContact('📱 ስልክ ቁጥር አጋራ / Share phone number').oneTime().resized();
}
