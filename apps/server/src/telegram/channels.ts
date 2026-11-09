import { GrammyError, InlineKeyboard, type Api } from 'grammy';
import type { ChannelPublisher } from '../modules/catalog/catalog.service';
import type { ChannelVerifier } from '../modules/shops/shops.service';
import { AppError } from '../shared/errors';
import type { Logger } from 'pino';

/** The bot's view of shop channels: checking its rights there and posting products. */
export class TelegramChannels implements ChannelVerifier, ChannelPublisher {
  constructor(
    private readonly api: Api,
    private readonly botId: number,
    private readonly logger: Logger,
  ) {}

  async verifyPostingRights(channel: string): Promise<{ chatId: number; title: string }> {
    try {
      const chat = await this.api.getChat(channel);
      if (chat.type !== 'channel') {
        throw new AppError('VALIDATION_FAILED', 'This chat is not a channel');
      }
      const member = await this.api.getChatMember(chat.id, this.botId);
      if (member.status !== 'administrator' || !member.can_post_messages) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Add the bot to the channel as an admin with permission to post messages',
        );
      }
      return { chatId: chat.id, title: chat.title };
    } catch (err) {
      if (err instanceof GrammyError) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Telegram cannot find this channel, or the bot is not a member',
        );
      }
      throw err;
    }
  }

  /**
   * Deletes the post. Telegram refuses to delete some older posts, so then it at least removes the
   * buy button. A failure is logged and swallowed: the product is already gone either way.
   */
  async unpublish(post: { chatId: number; messageId: number }): Promise<void> {
    try {
      await this.api.deleteMessage(post.chatId, post.messageId);
      return;
    } catch (err) {
      this.logger.warn({ err, ...post }, 'could not delete channel post');
    }
    try {
      await this.api.editMessageReplyMarkup(post.chatId, post.messageId, {
        reply_markup: new InlineKeyboard(),
      });
    } catch (err) {
      this.logger.warn({ err, ...post }, 'could not remove channel post button');
    }
  }

  async publish(post: Parameters<ChannelPublisher['publish']>[0]): Promise<number> {
    const options = {
      reply_markup: new InlineKeyboard().url(post.buttonText, post.buttonUrl),
    };
    const message = post.photoFileId
      ? await this.api.sendPhoto(post.chatId, post.photoFileId, {
          caption: post.caption,
          ...options,
        })
      : await this.api.sendMessage(post.chatId, post.caption, options);
    return message.message_id;
  }
}
