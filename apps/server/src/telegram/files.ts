import type { Api } from 'grammy';
import type { ImageFiles } from '../modules/payments/image-intake.service';

/** Telegram's file download address. The bot token is part of the path. */
const FILE_URL = 'https://api.telegram.org/file/bot';

/** Downloads files that customers send, for Gemini to read. Nothing is stored. */
export class TelegramFiles implements ImageFiles {
  constructor(
    private readonly api: Api,
    private readonly token: string,
  ) {}

  async download(fileId: string): Promise<string> {
    const file = await this.api.getFile(fileId);
    if (!file.file_path) throw new Error('Telegram returned no file path');
    const response = await fetch(`${FILE_URL}${this.token}/${file.file_path}`);
    // The URL holds the bot token, so the error names only the status.
    if (!response.ok) throw new Error(`File download failed with ${String(response.status)}`);
    return Buffer.from(await response.arrayBuffer()).toString('base64');
  }
}
