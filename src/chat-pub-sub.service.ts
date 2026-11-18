import { BeforeApplicationShutdown, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { Message } from './chat.types';

const CHAT_UPDATES_CHANNEL = 'ws_chat:message_updates';
const REDIS_TIMEOUT_MS = 5_000;

export interface ChatUpdate {
  participantIds: string[];
  chatId: string;
  messages: Message[];
}

@Injectable()
export class ChatPubSubService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(ChatPubSubService.name);
  private readonly publisher = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
    lazyConnect: true,
    enableOfflineQueue: false,
    autoResendUnfulfilledCommands: false,
    connectTimeout: REDIS_TIMEOUT_MS,
    commandTimeout: REDIS_TIMEOUT_MS,
  });
  private readonly subscriber = this.publisher.duplicate();

  async subscribe(deliver: (update: ChatUpdate) => void): Promise<void> {
    this.publisher.on('error', (error) => this.logger.error('Redis publisher error', error));
    this.subscriber.on('error', (error) => this.logger.error('Redis subscriber error', error));
    this.subscriber.on('message', (channel, message) => {
      if (channel !== CHAT_UPDATES_CHANNEL) return;
      try {
        const body = JSON.parse(message) as ChatUpdate;
        deliver(body);
      } catch (error) {
        this.logger.error('Failed to deliver Redis chat update', error);
      }
    });

    try {
      await Promise.all([this.publisher.connect(), this.subscriber.connect()]);
      await this.subscriber.subscribe(CHAT_UPDATES_CHANNEL);
    } catch (error) {
      this.beforeApplicationShutdown();
      throw error;
    }
  }

  async publish(update: ChatUpdate): Promise<void> {
    await this.publisher.publish(CHAT_UPDATES_CHANNEL, JSON.stringify(update));
  }

  beforeApplicationShutdown(): void {
    this.subscriber.disconnect();
    this.publisher.disconnect();
  }
}
