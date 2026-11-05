import { Composer, Keyboard } from 'grammy';
import type { BuchiContext } from '../../telegram/actor';
import { inlineKeyboard } from '../../telegram/keyboards';
import { availabilityText, phoneRequest } from './dispatch-messages.domain';
import { dutyCallbackData, dutyCallbackSchema, inviteTokenSchema } from './drivers.schemas';
import type { DriverService, LinkResult } from './drivers.service';

const linkProblems: Record<Exclude<LinkResult['status'], 'linked'>, string> = {
  invalid: 'ይህ ሊንክ አይሰራም / This invite link is not valid. Ask the shop for a new one.',
  expired: 'ይህ ሊንክ ጊዜው አልፏል / This invite link has expired. Ask the shop for a new one.',
  wrong_user:
    'ይህ ሊንክ ለሌላ ሰው ነው / This invite is for another Telegram username. ' +
    'Open it from the invited account.',
  already_linked: 'This Telegram account already drives for this shop.',
};

/** The availability button shows the one change a driver can make. */
function dutyPanel(available: boolean) {
  const button = available
    ? { text: '⚪ Off duty / ከስራ ውጪ', data: dutyCallbackData('off') }
    : { text: '🟢 Available / ዝግጁ ነኝ', data: dutyCallbackData('on') };
  return { text: availabilityText(available), reply_markup: inlineKeyboard([button]) };
}

const phoneKeyboard = () =>
  new Keyboard().requestContact('📱 ስልክ ቁጥር አጋራ / Share phone number').oneTime().resized();

/**
 * A driver joining through an invite link, sharing a phone number, and going available or off
 * duty. It runs before the purchase handlers, which also read `/start` and shared contacts.
 */
export function createDriverHandlers(drivers: DriverService): Composer<BuchiContext> {
  const handlers = new Composer<BuchiContext>();

  handlers.command('start', async (ctx, next) => {
    const token = inviteTokenSchema.safeParse(ctx.match);
    if (!token.success) return next();
    const result = await drivers.link(token.data, {
      telegramUserId: ctx.actor.telegramUserId,
      username: ctx.from?.username,
      name: ctx.from?.first_name ?? 'Driver',
    });
    if (result.status !== 'linked') {
      await ctx.reply(linkProblems[result.status]);
      return;
    }
    await ctx.reply(`✅ እንኳን ደህና መጡ / Welcome! You now deliver for ${result.shopName}.`);
    if (result.needsPhone) {
      await ctx.reply(phoneRequest, { reply_markup: phoneKeyboard() });
    } else {
      const panel = dutyPanel(false);
      await ctx.reply(panel.text, { reply_markup: panel.reply_markup });
    }
  });

  handlers.command('duty', async (ctx, next) => {
    if (ctx.actor.driverShopIds.length === 0) return next();
    const panel = dutyPanel(await drivers.isAvailable(ctx.actor.telegramUserId));
    await ctx.reply(panel.text, { reply_markup: panel.reply_markup });
  });

  // Only a driver's own number, and only while a shop lacks it, so contacts shared to buy pass on.
  handlers.on('message:contact', async (ctx, next) => {
    const { contact } = ctx.msg;
    if (ctx.actor.driverShopIds.length === 0 || contact.user_id !== ctx.from.id) return next();
    if (!(await drivers.savePhone(ctx.from.id, contact.phone_number))) return next();
    await ctx.reply('አመሰግናለሁ / Thank you!', { reply_markup: { remove_keyboard: true } });
    const panel = dutyPanel(false);
    await ctx.reply(panel.text, { reply_markup: panel.reply_markup });
  });

  handlers.callbackQuery(/^duty:/, async (ctx) => {
    const state = dutyCallbackSchema.safeParse(ctx.callbackQuery.data);
    if (!state.success || ctx.actor.driverShopIds.length === 0) {
      await ctx.answerCallbackQuery({ text: 'Only drivers can do this.' });
      return;
    }
    const available = state.data === 'on';
    if ((await drivers.setAvailability(ctx.from.id, available)) === 'needs_phone') {
      await ctx.answerCallbackQuery();
      await ctx.reply(phoneRequest, { reply_markup: phoneKeyboard() });
      return;
    }
    await ctx.answerCallbackQuery();
    const panel = dutyPanel(available);
    await ctx.editMessageText(panel.text, { reply_markup: panel.reply_markup });
  });

  return handlers;
}
