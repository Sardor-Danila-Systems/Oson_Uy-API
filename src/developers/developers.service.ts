import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
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

  /** Public developer directory (only those with at least one project). */
  async getPublicList() {
    const devs = await this.prisma.developer.findMany({
      where: { projects: { some: {} } },
      select: {
        id: true,
        name: true,
        logoUrl: true,
        _count: { select: { projects: true } },
      },
      orderBy: { projects: { _count: 'desc' } },
    });
    return devs.map((d) => ({
      id: d.id,
      name: d.name,
      logoUrl: d.logoUrl,
      projectsCount: d._count.projects,
    }));
  }

  /** Public SEO profile of a single developer + their projects. */
  async getPublicProfile(id: number) {
    const dev = await this.prisma.developer.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        logoUrl: true,
        description: true,
        phone: true,
        website: true,
        legalAddress: true,
        officeAddress: true,
        createdAt: true,
        projects: {
          select: {
            id: true,
            name: true,
            imageUrl: true,
            location: true,
            district: true,
            deliveryDate: true,
            totalUnits: true,
            media: { select: { imageUrl: true }, take: 1 },
            subscription: { select: { plan: true, status: true } },
          },
          orderBy: { id: 'desc' },
        },
      },
    });
    if (!dev) return null;

    const verified = dev.projects.some(
      (p) =>
        p.subscription &&
        (p.subscription.status === 'ACTIVE' ||
          p.subscription.status === 'TRIAL'),
    );

    return {
      id: dev.id,
      name: dev.name,
      logoUrl: dev.logoUrl,
      description: dev.description,
      phone: dev.phone,
      website: dev.website,
      legalAddress: dev.legalAddress,
      officeAddress: dev.officeAddress,
      createdAt: dev.createdAt,
      verified,
      projectsCount: dev.projects.length,
      projects: dev.projects.map((p) => ({
        id: p.id,
        name: p.name,
        imageUrl: p.imageUrl || p.media?.[0]?.imageUrl || null,
        location: p.location,
        district: p.district,
        deliveryDate: p.deliveryDate,
        totalUnits: p.totalUnits,
      })),
    };
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

    // Роль аккаунта в системе (для навигации дашборда):
    // владелец собственных проектов или OWNER/ADMIN где-то → OWNER,
    // иначе высшая роль среди участий (MANAGER / SALES).
    const memberships = await this.prisma.projectMember.findMany({
      where: { developerId: id },
      select: { role: true },
    });
    const roles = new Set(memberships.map((m) => m.role));
    let accountRole: 'OWNER' | 'MANAGER' | 'SALES' = 'OWNER';
    if (
      developer.projects.length > 0 ||
      roles.has('OWNER') ||
      roles.has('ADMIN')
    ) {
      accountRole = 'OWNER';
    } else if (roles.has('MANAGER')) {
      accountRole = 'MANAGER';
    } else if (roles.has('SALES')) {
      accountRole = 'SALES';
    }

    return {
      ...rest,
      telegramLinked: Boolean(telegramChatId),
      accountRole,
      isEmployee: accountRole !== 'OWNER',
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
    const data: UpdateDeveloperDto = { ...updateDeveloperDto };
    if (typeof data.email === 'string') {
      data.email = data.email.trim().toLowerCase();
      const clash = await this.prisma.developer.findUnique({
        where: { email: data.email },
      });
      if (clash && clash.id !== id) {
        throw new BadRequestException('Этот email уже используется');
      }
    }

    const updated = await this.prisma.developer.update({
      where: { id },
      data,
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

  private hashPassword(password: string) {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
  }

  private verifyPassword(password: string, stored: string) {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const hashedBuffer = Buffer.from(hash, 'hex');
    const supplied = scryptSync(password, salt, 64);
    return (
      hashedBuffer.length === supplied.length &&
      timingSafeEqual(hashedBuffer, supplied)
    );
  }

  /** Смена пароля: проверяем текущий, ставим новый. */
  async changePassword(
    developerId: number,
    currentPassword: string,
    newPassword: string,
  ) {
    if (!newPassword || newPassword.length < 6) {
      throw new BadRequestException('Новый пароль должен быть не короче 6 символов');
    }
    const dev = await this.prisma.developer.findUnique({
      where: { id: developerId },
    });
    if (!dev) throw new NotFoundException('Аккаунт не найден');
    if (!dev.passwordHash || !this.verifyPassword(currentPassword, dev.passwordHash)) {
      throw new UnauthorizedException('Текущий пароль указан неверно');
    }
    await this.prisma.developer.update({
      where: { id: developerId },
      data: { passwordHash: this.hashPassword(newPassword) },
    });
    return { ok: true };
  }
}
