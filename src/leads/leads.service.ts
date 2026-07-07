import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma.service';
import { NotificationsService } from '../common/services/notifications.service';
import { TelegramBotService } from '../telegram/telegram-bot.service';
import { ExpoPushService } from '../common/services/expo-push.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { FilterLeadDto } from './dto/filter-lead.dto';

function escapeTelegramHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHref(url: string): string {
  return url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

@Injectable()
export class LeadsService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private telegramBot: TelegramBotService,
    private expoPush: ExpoPushService,
  ) {}

  async create(createLeadDto: CreateLeadDto) {
    if (createLeadDto.floorId != null) {
      const floor = await this.prisma.projectFloor.findUnique({
        where: { id: createLeadDto.floorId },
        include: { areaOptions: true },
      });
      if (!floor) {
        throw new BadRequestException('Invalid floorId');
      }
      if (floor.projectId !== createLeadDto.projectId) {
        throw new BadRequestException(
          'floorId does not belong to the given projectId',
        );
      }
    }

    if (createLeadDto.apartmentId != null) {
      const apt = await this.prisma.apartmentUnit.findFirst({
        where: {
          id: createLeadDto.apartmentId,
          projectId: createLeadDto.projectId,
        },
      });
      if (!apt) {
        throw new BadRequestException(
          'apartmentId does not belong to the given projectId',
        );
      }
    }

    const lead = await this.prisma.lead.create({
      data: {
        name: createLeadDto.name,
        phone: createLeadDto.phone,
        projectId: createLeadDto.projectId,
        floorId: createLeadDto.floorId,
        apartmentId: createLeadDto.apartmentId,
      },
      include: {
        floor: {
          include: {
            areaOptions: { orderBy: { sortOrder: 'asc' } },
            project: { include: { developer: true } },
          },
        },
        project: { include: { developer: true } },
        apartment: true,
      },
    });

    const projectName =
      lead.project?.name ?? lead.floor?.project?.name ?? 'Unknown project';
    const interestHint =
      lead.floorId != null && lead.floor
        ? `floor ${lead.floor.floor} (id ${lead.floorId})`
        : 'general inquiry';

    await this.notificationsService.notifyNewLead(
      lead.name,
      interestHint,
      projectName,
    );

    const developer =
      lead.project?.developer ?? lead.floor?.project?.developer;

    if (developer?.id) {
      const title = 'Новая заявка';
      const body = `${lead.name} · ${projectName}`;
      await this.expoPush.notifyDeveloperNewLead({
        developerId: developer.id,
        title,
        body,
        data: {
          leadId: lead.id,
          projectId: lead.projectId,
          floorId: lead.floorId ?? null,
        },
      });
    }

    if (developer?.telegramChatId) {
      const dashboardBase =
        process.env.DASHBOARD_PUBLIC_URL ??
        process.env.FRONTEND_URL ??
        'http://localhost:3000';
      const leadsUrl = `${dashboardBase.replace(/\/$/, '')}/dashboard/leads`;
      const when = new Date(lead.createdAt).toLocaleString('ru-RU', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
      const areas =
        lead.floor?.areaOptions?.map((o) => `${o.areaSqm}`).join(', ') || '—';
      const floorHint =
        lead.floorId != null && lead.floor
          ? `\n🏢 <b>Этаж:</b> ${lead.floor.floor} · <b>${escapeTelegramHtml(String(Math.round(lead.floor.pricePerM2)))} сум/м²</b> · <b>м² варианты:</b> ${escapeTelegramHtml(areas)}`
          : '';
      const html = [
        '🎯 <b>Новая заявка</b> · <i>OsonUy</i>',
        '',
        '👤 <b>Имя:</b> ' + escapeTelegramHtml(lead.name),
        '📞 <b>Телефон:</b> <code>' +
          escapeTelegramHtml(lead.phone) +
          '</code>',
        '🏗 <b>Объект:</b> ' + escapeTelegramHtml(projectName),
        '🆔 <b>№ заявки:</b> <code>' + String(lead.id) + '</code>',
        '🕐 <b>Когда:</b> ' + escapeTelegramHtml(when),
        floorHint,
        '',
        '✅ Статус и ссылка на отзыв — в кабинете.',
        '👉 <a href="' + escapeHref(leadsUrl) + '">Открыть раздел «Заявки»</a>',
      ]
        .filter(Boolean)
        .join('\n');
      await this.telegramBot.sendHtml(developer.telegramChatId, html);
    }

    return lead;
  }

  async findAll(filters?: FilterLeadDto, developerId?: number) {
    const where: Prisma.LeadWhereInput = {};

    if (filters?.projectId) {
      where.projectId = filters.projectId;
    }

    if (filters?.status) {
      where.status = filters.status;
    }

    if (developerId) {
      // проекты, где пользователь владелец ИЛИ участник (сотрудник)
      where.project = {
        OR: [{ developerId }, { members: { some: { developerId } } }],
      };
    }

    const search = filters?.search?.trim();
    if (search) {
      const digits = search.replace(/\D/g, '');
      where.AND = [
        ...(where.AND && Array.isArray(where.AND) ? where.AND : []),
        {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            ...(digits ? [{ phone: { contains: digits } }] : []),
          ],
        },
      ];
    }

    const page = filters?.page;
    const limitResolved =
      page != null
        ? Math.min(Math.max(filters?.limit ?? 50, 1), 200)
        : filters?.limit != null
          ? Math.min(Math.max(filters.limit, 1), 200)
          : null;
    const skip =
      page != null && limitResolved != null
        ? (Math.max(page, 1) - 1) * limitResolved
        : undefined;
    const take = limitResolved ?? undefined;

    const include = {
      floor: {
        include: {
          project: true,
          areaOptions: { orderBy: { sortOrder: 'asc' as const } },
        },
      },
      project: true,
      apartment: true,
      feedback: true,
    };

    if (page != null && limitResolved != null) {
      const [items, total] = await Promise.all([
        this.prisma.lead.findMany({
          where: Object.keys(where).length > 0 ? where : undefined,
          include,
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
        this.prisma.lead.count({
          where: Object.keys(where).length > 0 ? where : undefined,
        }),
      ]);
      return { items, total, page, limit: limitResolved };
    }

    return this.prisma.lead.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
      include,
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: number, developerId?: number) {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
      include: {
        floor: {
          include: { project: true, areaOptions: { orderBy: { sortOrder: 'asc' } } },
        },
        project: true,
        apartment: true,
        feedback: true,
      },
    });
    if (!lead) {
      throw new NotFoundException('Lead not found');
    }
    if (developerId) {
      const devId =
        lead.project?.developerId ?? lead.floor?.project?.developerId;
      if (devId !== developerId) {
        throw new ForbiddenException('No access to this lead');
      }
    }
    return lead;
  }

  async update(id: number, updateLeadDto: UpdateLeadDto, developerId?: number) {
    const existing = developerId
      ? await this.findOne(id, developerId)
      : await this.prisma.lead.findUnique({
          where: { id },
          include: { project: true },
        });
    if (!existing) {
      throw new NotFoundException('Lead not found');
    }

    if (updateLeadDto.apartmentId !== undefined && updateLeadDto.apartmentId != null) {
      const pid = existing.projectId;
      if (!pid) {
        throw new BadRequestException('Lead has no project to attach apartment');
      }
      const apt = await this.prisma.apartmentUnit.findFirst({
        where: { id: updateLeadDto.apartmentId, projectId: pid },
      });
      if (!apt) {
        throw new BadRequestException(
          'apartmentId does not belong to the lead project',
        );
      }
    }

    const data: Prisma.LeadUpdateInput = {};
    if (updateLeadDto.status != null) {
      data.status = updateLeadDto.status;
    }
    if (updateLeadDto.apartmentId !== undefined) {
      data.apartment =
        updateLeadDto.apartmentId === null
          ? { disconnect: true }
          : { connect: { id: updateLeadDto.apartmentId } };
    }

    const lead = await this.prisma.lead.update({
      where: { id },
      data,
      include: {
        floor: {
          include: { project: true, areaOptions: { orderBy: { sortOrder: 'asc' } } },
        },
        project: true,
        apartment: true,
        feedback: true,
      },
    });

    if (updateLeadDto.status) {
      await this.notificationsService.notifyLeadStatusChange(
        lead.name,
        updateLeadDto.status,
        lead.project?.name ?? 'Unknown project',
      );
    }

    return lead;
  }

  async createFeedbackRequest(leadId: number, developerId?: number) {
    const lead = await this.findOne(leadId, developerId);

    const token = randomUUID();
    const feedback = await this.prisma.leadFeedback.upsert({
      where: { leadId },
      update: {
        token,
      },
      create: {
        leadId,
        token,
      },
    });

    return {
      leadId,
      token: feedback.token,
      feedbackUrl: `${process.env.FRONTEND_URL ?? 'http://localhost:3000'}/feedback/${feedback.token}`,
    };
  }

  async submitFeedback(
    token: string,
    payload: { rating: number; comment?: string },
  ) {
    try {
      return await this.prisma.leadFeedback.update({
        where: { token },
        data: {
          rating: payload.rating,
          comment: payload.comment,
          submittedAt: new Date(),
        },
        include: {
          lead: {
            include: {
              project: true,
            },
          },
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Feedback link is invalid or expired');
      }
      throw error;
    }
  }

  async getFeedbackSummary(developerId?: number) {
    const feedbacks = await this.prisma.leadFeedback.findMany({
      where: {
        submittedAt: { not: null },
        ...(developerId
          ? {
              lead: {
                project: {
                  developerId,
                },
              },
            }
          : {}),
      },
      include: {
        lead: {
          include: {
            project: true,
          },
        },
      },
      orderBy: {
        submittedAt: 'desc',
      },
    });

    const avgRating = feedbacks.length
      ? Number(
          (
            feedbacks.reduce((sum, item) => sum + (item.rating ?? 0), 0) /
            feedbacks.length
          ).toFixed(1),
        )
      : null;

    return {
      avgRating,
      totalFeedbacks: feedbacks.length,
      items: feedbacks,
    };
  }
}
