import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma.service';
import { ExpoPushService } from '../common/services/expo-push.service';
import { CreateDeveloperDto } from './dto/create-developer.dto';
import { UpdateDeveloperDto } from './dto/update-developer.dto';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';

@Injectable()
export class DevelopersService {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private expoPushService: ExpoPushService,
  ) {}

  async create(createDeveloperDto: CreateDeveloperDto) {
    return this.prisma.developer.create({
      data: createDeveloperDto,
    });
  }

  async findAll() {
    return this.prisma.developer.findMany({
      include: {
        projects: true,
      },
    });
  }

  async findById(id: number) {
    const developer = await this.prisma.developer.findUnique({
      where: { id },
      include: {
        projects: true,
      },
    });
    if (!developer) {
      return null;
    }
    const {
      passwordHash: _p,
      telegramLinkToken: _t,
      telegramLinkExpiresAt: _e,
      telegramChatId,
      ...rest
    } = developer;
    return {
      ...rest,
      telegramLinked: Boolean(telegramChatId),
    };
  }

  async createTelegramLink(developerId: number) {
    const rawUsername = this.configService.get<string>('TELEGRAM_BOT_USERNAME');
    const username = rawUsername?.replace(/^@/, '')?.trim();
    if (!username) {
      throw new BadRequestException(
        'TELEGRAM_BOT_USERNAME is not configured on the server',
      );
    }
    const token = randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await this.prisma.developer.update({
      where: { id: developerId },
      data: {
        telegramLinkToken: token,
        telegramLinkExpiresAt: expiresAt,
      },
    });
    return {
      deepLink: `https://t.me/${username}?start=${token}`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async registerPushToken(developerId: number, dto: RegisterPushTokenDto) {
    await this.prisma.developerDevice.upsert({
      where: { expoPushToken: dto.expoPushToken },
      update: {
        developerId,
        platform: dto.platform,
      },
      create: {
        developerId,
        expoPushToken: dto.expoPushToken,
        platform: dto.platform,
      },
    });

    // Send test notification to verify token works
    await this.expoPushService.sendTestNotification(dto.expoPushToken);

    return { ok: true };
  }

  async update(id: number, updateDeveloperDto: UpdateDeveloperDto) {
    const updated = await this.prisma.developer.update({
      where: { id },
      data: updateDeveloperDto,
      include: {
        projects: true,
      },
    });
    const {
      passwordHash: _p,
      telegramLinkToken: _t,
      telegramLinkExpiresAt: _e,
      telegramChatId,
      ...rest
    } = updated;
    return {
      ...rest,
      telegramLinked: Boolean(telegramChatId),
    };
  }
}
