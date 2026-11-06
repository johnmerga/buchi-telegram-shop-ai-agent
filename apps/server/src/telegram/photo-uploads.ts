import { GrammyError, InputFile, type Api } from 'grammy';
import type { PhotoUploads } from '../modules/catalog/catalog.routes';
import { AppError } from '../shared/errors';

/**
 * Uploads a product photo from the dashboard. Telegram gives a file ID only for a sent message, so
 * the photo goes to the owner's own chat with the bot, silently, and that message is deleted.
 */
export class TelegramPhotoUploads implements PhotoUploads {
  constructor(private readonly api: Api) {}

  async upload(ownerChatId: number, image: Buffer): Promise<string> {
    const message = await this.api
      .sendPhoto(ownerChatId, new InputFile(image), { disable_notification: true })
      .catch((err: unknown) => {
        throw err instanceof GrammyError ? rejected(err) : err;
      });
    await this.api.deleteMessage(ownerChatId, message.message_id);
    const largest = message.photo.at(-1);
    if (!largest) throw new Error('Telegram returned a photo message without a photo');
    return largest.file_id;
  }
}

/** Telegram answers 403 when the owner has not started the bot, and 400 for an unreadable image. */
function rejected(err: GrammyError): AppError {
  return err.error_code === 403
    ? new AppError('CONFLICT', 'Open the chat with the bot and press Start, then add the photo')
    : new AppError('VALIDATION_FAILED', 'Telegram could not read this image');
}
