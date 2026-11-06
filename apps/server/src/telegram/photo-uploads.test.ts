import { Api } from 'grammy';
import { describe, expect, it } from 'vitest';
import { TelegramPhotoUploads } from './photo-uploads';

function refusingApi(errorCode: number, description: string): Api {
  const api = new Api('test');
  api.config.use(() => Promise.resolve({ ok: false, error_code: errorCode, description } as never));
  return api;
}

describe('TelegramPhotoUploads', () => {
  it('asks the owner to start the bot when Telegram cannot message them', async () => {
    const uploads = new TelegramPhotoUploads(
      refusingApi(403, "Forbidden: bot can't initiate conversation with a user"),
    );
    await expect(uploads.upload(1, Buffer.from('jpeg'))).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringContaining('press Start') as unknown,
    });
  });

  it('reports an image that Telegram cannot read as invalid', async () => {
    const uploads = new TelegramPhotoUploads(refusingApi(400, 'Bad Request: IMAGE_PROCESS_FAILED'));
    await expect(uploads.upload(1, Buffer.from('not an image'))).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });
});
