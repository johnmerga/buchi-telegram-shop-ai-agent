import type { Update } from 'grammy/types';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { connectDatabase } from '../../src/db/client';
import { telegramUpdates } from '../../src/db/schema';
import { createApp } from '../../src/http/app';
import { TelegramIngress } from '../../src/telegram/ingress';
import { TelegramUpdatesRepo } from '../../src/telegram/updates.repo';
import { createTelegramWebhookRouter } from '../../src/telegram/webhook.routes';
import { UpdateWorker, type UpdateHandler } from '../../src/telegram/worker';
import { testDatabaseUrl } from './test-database';

const { db, close } = connectDatabase(testDatabaseUrl);
const logger = pino({ level: 'silent' });
const secret = 's'.repeat(32);
const repo = new TelegramUpdatesRepo(db);

function setUp(handle: UpdateHandler) {
  const worker = new UpdateWorker(repo, handle, logger);
  const app = createApp({
    logger,
    routers: [createTelegramWebhookRouter({ secret, ingress: new TelegramIngress(repo, worker) })],
  });
  const post = (update: Update) =>
    request(app)
      .post('/telegram/webhook')
      .set('x-telegram-bot-api-secret-token', secret)
      .send(update);
  return { worker, app, post };
}

/** A handler that records the IDs it sees and fails for the IDs in `failFor`. */
function recorder(failFor: number[] = []) {
  const handled: number[] = [];
  const handle: UpdateHandler = (update) => {
    if (failFor.includes(update.update_id)) return Promise.reject(new Error('boom'));
    handled.push(update.update_id);
    return Promise.resolve();
  };
  return { handled, handle };
}

const message = (updateId: number): Update => ({
  update_id: updateId,
  message: {
    message_id: updateId,
    date: 0,
    chat: { id: 7, type: 'private', first_name: 'Abebe' },
    from: { id: 7, is_bot: false, first_name: 'Abebe' },
    text: 'hi',
  },
});

beforeEach(async () => {
  await db.delete(telegramUpdates);
});

afterAll(close);

describe('Telegram webhook ingress', () => {
  it('processes an update that Telegram sends twice only once', async () => {
    const { handled, handle } = recorder();
    const { worker, post } = setUp(handle);

    expect((await post(message(1))).status).toBe(200);
    expect((await post(message(1))).status).toBe(200);
    await worker.idle();

    expect(handled).toEqual([1]);
  });

  it('rejects a request without the secret header', async () => {
    const { app } = setUp(recorder().handle);
    const res = await request(app).post('/telegram/webhook').send(message(2));
    expect(res.status).toBe(401);
  });

  it('rejects a body that is not an update', async () => {
    const { app } = setUp(recorder().handle);
    const res = await request(app)
      .post('/telegram/webhook')
      .set('x-telegram-bot-api-secret-token', secret)
      .send({ hello: 'world' });
    expect(res.status).toBe(400);
  });

  it('marks a failing update and still processes the next one', async () => {
    const { handled, handle } = recorder([3]);
    const { worker, post } = setUp(handle);

    await post(message(3));
    await post(message(4));
    await worker.idle();

    const rows = await db.select().from(telegramUpdates).orderBy(telegramUpdates.updateId);
    expect(rows.map((r) => [r.updateId, r.status, r.error])).toEqual([
      [3, 'failed', 'boom'],
      [4, 'done', null],
    ]);
    expect(handled).toEqual([4]);
  });

  it('processes updates that a restart interrupted', async () => {
    await db
      .insert(telegramUpdates)
      .values({ updateId: 5, payload: message(5), status: 'processing' });
    const { handled, handle } = recorder();
    const worker = new UpdateWorker(repo, handle, logger);

    await repo.requeueInterrupted();
    worker.wake();
    await worker.idle();

    expect(handled).toEqual([5]);
  });
});
