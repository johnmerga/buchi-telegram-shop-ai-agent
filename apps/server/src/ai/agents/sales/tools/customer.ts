import { AppError } from '../../../../shared/errors';
import type { CustomersService } from '../../../../modules/customers/customers.service';
import type { ToolCallContext } from '../../../tool';

/** The customer a sales tool acts for, from the Telegram user ID that code resolved. */
export async function customerOf(
  customers: Pick<CustomersService, 'byTelegramUser'>,
  context: ToolCallContext,
) {
  if (context.actor.kind !== 'telegram_user') {
    throw new AppError('FORBIDDEN', 'This tool acts only for a customer.');
  }
  return customers.byTelegramUser(context.shopId, context.actor.telegramUserId);
}
