import { Module } from '@nestjs/common';
import { ChatPubSubService } from './chat-pub-sub.service';
import { ChatGateway } from './chat.gateway';
import { DatabaseService } from './database.service';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
  providers: [DatabaseService, ChatPubSubService, ChatGateway],
})
export class AppModule {}
