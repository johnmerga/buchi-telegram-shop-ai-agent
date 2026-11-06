import type { Api } from 'grammy';
import type { Coordinates } from '../modules/delivery/location.domain';
import type { LiveMap } from '../modules/drivers/live-tracking.service';
import type { MessageRef } from '../modules/owner/owner-notifier.service';

/** Live Location messages that Buchi sends, moves, and stops in customers' chats. */
export class TelegramLiveMap implements LiveMap {
  constructor(private readonly api: Api) {}

  async send(chatId: number, point: Coordinates, livePeriod: number): Promise<number> {
    const { latitude, longitude } = point;
    const message = await this.api.sendLocation(chatId, latitude, longitude, {
      live_period: livePeriod,
    });
    return message.message_id;
  }

  async move(message: MessageRef, point: Coordinates): Promise<void> {
    await this.api.editMessageLiveLocation(
      message.chatId,
      message.messageId,
      point.latitude,
      point.longitude,
    );
  }

  async stop(message: MessageRef): Promise<void> {
    await this.api.stopMessageLiveLocation(message.chatId, message.messageId);
  }
}
