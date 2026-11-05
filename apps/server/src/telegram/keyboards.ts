import { InlineKeyboard } from 'grammy';
import type { Button } from '../modules/owner/owner.domain';

export function inlineKeyboard(buttons: Button[]): InlineKeyboard {
  return InlineKeyboard.from([
    buttons.map((button) => InlineKeyboard.text(button.text, button.data)),
  ]);
}
