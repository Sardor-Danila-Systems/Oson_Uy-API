import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NotificationService } from './services/notification.service';
import { ExpoPushService } from './services/expo-push.service';
import { PrismaService } from '../prisma.service';

@Module({
  imports: [ConfigModule],
  providers: [NotificationService, ExpoPushService, PrismaService],
  exports: [NotificationService, ExpoPushService],
})
export class CommonModule {}
