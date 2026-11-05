import { Readable } from 'node:stream';
import type { Api } from 'grammy';
import type { ImageFiles } from '../modules/payments/image-intake.service';
import type { ScreenshotFiles, ScreenshotStream } from '../modules/payments/payments.routes';

/** Telegram's file download address. The bot token is part of the path. */
const FILE_URL = 'https://api.telegram.org/file/bot';

/** Telegram serves every file as a download, so the type comes from the file's extension. */
const imageTypes: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** Downloads files that customers send, for Gemini to read and for the owner to see. Nothing is stored. */
export class TelegramFiles implements ImageFiles, ScreenshotFiles {
  constructor(
    private readonly api: Api,
    private readonly token: string,
  ) {}

  async download(fileId: string): Promise<string> {
    const { response } = await this.fetchFile(fileId);
    return Buffer.from(await response.arrayBuffer()).toString('base64');
  }

  async open(fileId: string): Promise<ScreenshotStream> {
    const { path, response } = await this.fetchFile(fileId);
    if (!response.body) throw new Error('Telegram returned an empty file');
    const extension = path.split('.').pop()?.toLowerCase() ?? '';
    return {
      contentType: imageTypes[extension] ?? 'application/octet-stream',
      body: Readable.fromWeb(response.body),
    };
  }

  private async fetchFile(fileId: string): Promise<{ path: string; response: Response }> {
    const file = await this.api.getFile(fileId);
    if (!file.file_path) throw new Error('Telegram returned no file path');
    const response = await fetch(`${FILE_URL}${this.token}/${file.file_path}`);
    // The URL holds the bot token, so the error names only the status.
    if (!response.ok) throw new Error(`File download failed with ${String(response.status)}`);
    return { path: file.file_path, response };
  }
}
