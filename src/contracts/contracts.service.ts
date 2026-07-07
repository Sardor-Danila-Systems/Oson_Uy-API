import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApartmentStatus, ContractStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CreateContractDto } from './dto/create-contract.dto';
import { UpdateContractDto } from './dto/update-contract.dto';
import { FilterContractDto } from './dto/filter-contract.dto';
import { AddPaymentDto } from './dto/add-payment.dto';

const CONTRACT_INCLUDE = {
  apartment: {
    select: {
      id: true,
      number: true,
      floor: true,
      sectionKey: true,
      rooms: true,
      areaSqm: true,
      priceUzs: true,
      pricePerM2Uzs: true,
      renovationState: true,
      apartmentClass: true,
      layoutImageUrl: true,
      status: true,
      project: { select: { id: true, name: true } },
    },
  },
  customer: {
    select: {
      id: true,
      name: true,
      phone: true,
      passportSeries: true,
      passportNumber: true,
      passportIssuedBy: true,
      passportIssuedAt: true,
      pinfl: true,
      birthDate: true,
      address: true,
      city: true,
      region: true,
      email: true,
    },
  },
  manager: { select: { id: true, name: true, phone: true } },
  broker: { select: { id: true, name: true, phone: true } },
  payments: {
    orderBy: { paidAt: 'desc' as const },
    select: {
      id: true,
      amountUzs: true,
      paidAt: true,
      type: true,
      method: true,
      comment: true,
      receiptUrl: true,
      createdAt: true,
    },
  },
  paymentSchedule: {
    orderBy: { sortOrder: 'asc' as const },
    select: {
      id: true,
      dueDate: true,
      amountUzs: true,
      isPaid: true,
      paidAt: true,
      sortOrder: true,
    },
  },
} satisfies Prisma.ContractInclude;

@Injectable()
export class ContractsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async assertMember(projectId: number, developerId: number) {
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_developerId: { projectId, developerId } },
    });
    if (!member) throw new ForbiddenException('Access denied');
  }

  /** Журнал изменений — «кто, что и когда поменял» (виден в разделе Финансы). */
  private async audit(
    projectId: number,
    entity: string,
    entityId: number,
    action: string,
    summary: string,
    developerId?: number,
    details?: unknown,
  ) {
    try {
      await this.prisma.auditLog.create({
        data: {
          projectId,
          entity,
          entityId,
          action,
          summary,
          developerId: developerId ?? null,
          details:
            details === undefined
              ? undefined
              : (details as Prisma.InputJsonValue),
        },
      });
    } catch {
      /* журнал не должен ломать основную операцию */
    }
  }

  private async generateContractNumber(projectId: number): Promise<string> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true },
    });
    // Take first 3 chars of project name as prefix, e.g. "Avenue Plaza" → "AVE"
    const prefix = (project?.name ?? 'CON')
      .replace(/[^A-Za-zА-Яа-я]/g, '')
      .slice(0, 3)
      .toUpperCase();

    const count = await this.prisma.contract.count({ where: { projectId } });
    return `${prefix}-${count + 1}`;
  }

  /** Clamp a day-of-month to a valid value for the given year/month. */
  private dueDateFor(
    contractDate: Date,
    monthsAhead: number,
    paymentDay: number,
  ): Date {
    const year = contractDate.getFullYear();
    const month = contractDate.getMonth() + monthsAhead;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return new Date(year, month, Math.min(paymentDay, daysInMonth));
  }

  private generateSchedule(
    contractId: number,
    totalPriceUzs: bigint,
    firstPaymentUzs: bigint,
    termMonths: number,
    contractDate: Date,
    paymentDay: number,
  ) {
    const remaining = totalPriceUzs - firstPaymentUzs;
    if (remaining <= 0n || termMonths <= 1) return [];

    const monthly = remaining / BigInt(termMonths);
    const lastExtra = remaining - monthly * BigInt(termMonths);

    return Array.from({ length: termMonths }, (_, i) => ({
      contractId,
      dueDate: this.dueDateFor(contractDate, i + 1, paymentDay),
      amountUzs: i === termMonths - 1 ? monthly + lastExtra : monthly,
      sortOrder: i + 1,
    }));
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  async list(projectId: number, developerId: number, query: FilterContractDto) {
    await this.assertMember(projectId, developerId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;
    const search = query.search?.trim();

    const where: Prisma.ContractWhereInput = {
      projectId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.paymentMethod ? { paymentMethod: query.paymentMethod } : {}),
      ...(query.managerId ? { managerId: query.managerId } : {}),
      ...(search
        ? {
            OR: [
              { number: { contains: search, mode: 'insensitive' } },
              { customer: { name: { contains: search, mode: 'insensitive' } } },
              {
                customer: {
                  phone: { contains: search.replace(/\D/g, '') },
                },
              },
              { apartment: { number: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        skip,
        take: limit,
        orderBy: { contractDate: 'desc' },
        include: CONTRACT_INCLUDE,
      }),
      this.prisma.contract.count({ where }),
    ]);

    // Compute paid totals per contract
    const enriched = items.map((c) => {
      const paidUzs = c.payments.reduce((s, p) => s + p.amountUzs, 0n);
      const remainingUzs = c.totalPriceUzs - paidUzs;
      return { ...c, paidUzs, remainingUzs };
    });

    return { items: enriched, total, page, limit };
  }

  async findOne(projectId: number, contractId: number, developerId: number) {
    await this.assertMember(projectId, developerId);

    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, projectId },
      include: CONTRACT_INCLUDE,
    });
    if (!contract) throw new NotFoundException('Contract not found');

    const paidUzs = contract.payments.reduce((s, p) => s + p.amountUzs, 0n);
    const remainingUzs = contract.totalPriceUzs - paidUzs;

    // Current month debt
    const now = new Date();
    const overdueItems = contract.paymentSchedule.filter(
      (s) => !s.isPaid && new Date(s.dueDate) < now,
    );
    const debtUzs = overdueItems.reduce((s, i) => s + i.amountUzs, 0n);

    return { ...contract, paidUzs, remainingUzs, debtUzs };
  }

  async create(projectId: number, developerId: number, dto: CreateContractDto) {
    await this.assertMember(projectId, developerId);

    // Verify apartment belongs to project
    const apartment = await this.prisma.apartmentUnit.findFirst({
      where: { id: dto.apartmentId, projectId },
    });
    if (!apartment) throw new NotFoundException('Apartment not found');

    // Verify customer belongs to project
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, projectId },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const number = await this.generateContractNumber(projectId);
    const contractDate = dto.contractDate ? new Date(dto.contractDate) : new Date();
    // Day of month for installments — defaults to the contract date's day
    const paymentDay = dto.paymentDay ?? contractDate.getDate();
    const totalPriceUzs = BigInt(Math.round(dto.totalPriceUzs));
    const discountPercent = dto.discountPercent ?? 0;
    const termMonths = dto.termMonths;

    // For full / cash payments without an explicit first payment, the whole
    // sum is paid up-front. Otherwise the first payment is the down payment.
    const isFullUpfront =
      dto.paymentMethod === 'FULL' || dto.paymentMethod === 'CASH';
    let firstPaymentUzs = BigInt(Math.round(dto.firstPaymentUzs));
    if (isFullUpfront && firstPaymentUzs <= 0n) {
      firstPaymentUzs = totalPriceUzs;
    }
    if (firstPaymentUzs > totalPriceUzs) firstPaymentUzs = totalPriceUzs;

    // The contract is fully covered by the up-front payment
    const fullyPaidUpfront =
      totalPriceUzs > 0n && firstPaymentUzs >= totalPriceUzs;

    // Determine apartment status from payment method
    const aptStatus: ApartmentStatus = fullyPaidUpfront
      ? ApartmentStatus.SOLD
      : dto.paymentMethod === 'MORTGAGE'
        ? ApartmentStatus.MORTGAGE
        : dto.paymentMethod === 'INSTALLMENT'
          ? ApartmentStatus.INSTALLMENT
          : ApartmentStatus.SOLD;

    const [contract] = await this.prisma.$transaction(async (tx) => {
      const created = await tx.contract.create({
        data: {
          projectId,
          apartmentId: dto.apartmentId,
          customerId: dto.customerId,
          managerId: dto.managerId ?? developerId,
          brokerId: dto.brokerId,
          number,
          status: fullyPaidUpfront ? 'COMPLETED' : 'ACTIVE',
          paymentMethod: dto.paymentMethod,
          totalPriceUzs,
          discountPercent,
          firstPaymentUzs,
          termMonths,
          paymentDay,
          monthlyAmountUzs:
            termMonths > 1
              ? (totalPriceUzs - firstPaymentUzs) / BigInt(termMonths)
              : null,
          contractDate,
          notes: dto.notes,
        },
        include: CONTRACT_INCLUDE,
      });

      // Record the first / up-front payment so it is counted everywhere:
      // contract balance, customer cabinet and project analytics.
      if (firstPaymentUzs > 0n) {
        await tx.customerPayment.create({
          data: {
            customerId: dto.customerId,
            contractId: created.id,
            amountUzs: firstPaymentUzs,
            paidAt: contractDate,
            type: fullyPaidUpfront ? 'FULL' : 'DEPOSIT',
            comment: 'Первоначальный взнос',
          },
        });
      }

      // Generate payment schedule (installments after the first payment)
      const scheduleItems = this.generateSchedule(
        created.id,
        totalPriceUzs,
        firstPaymentUzs,
        termMonths,
        contractDate,
        paymentDay,
      );
      if (scheduleItems.length > 0) {
        await tx.paymentScheduleItem.createMany({ data: scheduleItems });
      }

      // Update apartment status
      await tx.apartmentUnit.update({
        where: { id: dto.apartmentId },
        data: { status: aptStatus },
      });

      return [created];
    });

    await this.audit(
      projectId,
      'CONTRACT',
      contract.id,
      'CREATED',
      `Создан договор №${contract.number} на ${totalPriceUzs.toLocaleString('ru-RU')} сум`,
      developerId,
    );

    return this.findOne(projectId, contract.id, developerId);
  }

  async update(
    projectId: number,
    contractId: number,
    developerId: number,
    dto: UpdateContractDto,
  ) {
    await this.assertMember(projectId, developerId);

    const existing = await this.prisma.contract.findFirst({
      where: { id: contractId, projectId },
    });
    if (!existing) throw new NotFoundException('Contract not found');

    // If status changes to CANCELED — free the apartment
    const data: Prisma.ContractUpdateInput = {};
    if (dto.status) data.status = dto.status;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.totalPriceUzs !== undefined)
      data.totalPriceUzs = BigInt(Math.round(dto.totalPriceUzs));
    if (dto.firstPaymentUzs !== undefined)
      data.firstPaymentUzs = BigInt(Math.round(dto.firstPaymentUzs));
    if (dto.discountPercent !== undefined)
      data.discountPercent = dto.discountPercent;
    if (dto.termMonths !== undefined) data.termMonths = dto.termMonths;
    if (dto.paymentMethod !== undefined) data.paymentMethod = dto.paymentMethod;
    if (dto.paymentDay !== undefined) data.paymentDay = dto.paymentDay;

    await this.prisma.$transaction(async (tx) => {
      await tx.contract.update({ where: { id: contractId }, data });

      // Shift the due day of all UNPAID installments to the new payment day,
      // keeping each item's month/year (paid items stay as history).
      if (dto.paymentDay !== undefined) {
        const day = dto.paymentDay;
        const items = await tx.paymentScheduleItem.findMany({
          where: { contractId, isPaid: false },
        });
        for (const item of items) {
          const d = new Date(item.dueDate);
          const daysInMonth = new Date(
            d.getFullYear(),
            d.getMonth() + 1,
            0,
          ).getDate();
          d.setDate(Math.min(day, daysInMonth));
          await tx.paymentScheduleItem.update({
            where: { id: item.id },
            data: { dueDate: d },
          });
        }
      }

      // Keep the recorded first-payment in sync when it is edited, so the
      // contract balance / analytics stay correct.
      if (dto.firstPaymentUzs !== undefined) {
        const newFirst = BigInt(Math.round(dto.firstPaymentUzs));
        const deposit = await tx.customerPayment.findFirst({
          where: {
            contractId,
            comment: 'Первоначальный взнос',
          },
          orderBy: { paidAt: 'asc' },
        });
        if (deposit) {
          if (newFirst > 0n) {
            await tx.customerPayment.update({
              where: { id: deposit.id },
              data: { amountUzs: newFirst },
            });
          } else {
            await tx.customerPayment.delete({ where: { id: deposit.id } });
          }
        } else if (newFirst > 0n) {
          await tx.customerPayment.create({
            data: {
              customerId: existing.customerId,
              contractId,
              amountUzs: newFirst,
              paidAt: existing.contractDate,
              type: 'DEPOSIT',
              comment: 'Первоначальный взнос',
            },
          });
        }
      }

      if (dto.status === 'CANCELED') {
        await tx.apartmentUnit.update({
          where: { id: existing.apartmentId },
          data: { status: ApartmentStatus.AVAILABLE },
        });
      }
    });

    // Пишем в журнал, что именно изменили
    const changes: string[] = [];
    if (dto.totalPriceUzs !== undefined && BigInt(Math.round(dto.totalPriceUzs)) !== existing.totalPriceUzs)
      changes.push(`сумма: ${existing.totalPriceUzs.toLocaleString('ru-RU')} → ${Math.round(dto.totalPriceUzs).toLocaleString('ru-RU')}`);
    if (dto.firstPaymentUzs !== undefined && BigInt(Math.round(dto.firstPaymentUzs)) !== existing.firstPaymentUzs)
      changes.push(`взнос: ${existing.firstPaymentUzs.toLocaleString('ru-RU')} → ${Math.round(dto.firstPaymentUzs).toLocaleString('ru-RU')}`);
    if (dto.termMonths !== undefined && dto.termMonths !== existing.termMonths)
      changes.push(`срок: ${existing.termMonths} → ${dto.termMonths} мес.`);
    if (dto.paymentMethod !== undefined && dto.paymentMethod !== existing.paymentMethod)
      changes.push(`способ оплаты: ${existing.paymentMethod} → ${dto.paymentMethod}`);
    if (dto.status !== undefined && dto.status !== existing.status)
      changes.push(`статус: ${existing.status} → ${dto.status}`);
    if (dto.paymentDay !== undefined && dto.paymentDay !== existing.paymentDay)
      changes.push(`день платежа: ${existing.paymentDay ?? '—'} → ${dto.paymentDay}`);
    if (changes.length) {
      await this.audit(
        projectId,
        'CONTRACT',
        contractId,
        'UPDATED',
        `Договор №${existing.number}: ${changes.join('; ')}`,
        developerId,
      );
    }

    return this.findOne(projectId, contractId, developerId);
  }

  async remove(projectId: number, contractId: number, developerId: number) {
    await this.assertMember(projectId, developerId);

    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, projectId },
    });
    if (!contract) throw new NotFoundException('Contract not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.contract.delete({ where: { id: contractId } });
      // Free the apartment
      await tx.apartmentUnit.update({
        where: { id: contract.apartmentId },
        data: { status: ApartmentStatus.AVAILABLE },
      });
    });
  }

  // ── Payments ──────────────────────────────────────────────────────────────

  async addPayment(
    projectId: number,
    contractId: number,
    developerId: number,
    dto: AddPaymentDto,
  ) {
    await this.assertMember(projectId, developerId);

    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, projectId },
      include: { customer: true },
    });
    if (!contract) throw new NotFoundException('Contract not found');

    const amountUzs = BigInt(Math.round(dto.amountUzs));
    const paidAt = new Date(dto.paidAt);

    await this.prisma.$transaction(async (tx) => {
      const payment = await tx.customerPayment.create({
        data: {
          customerId: contract.customerId,
          contractId,
          amountUzs,
          paidAt,
          type: dto.type ?? 'OTHER',
          method: dto.method ?? 'CASH',
          comment: dto.comment,
          receiptUrl: dto.receiptUrl,
        },
      });

      // Mark the earliest unpaid schedule item as paid
      const scheduleItem = await tx.paymentScheduleItem.findFirst({
        where: { contractId, isPaid: false },
        orderBy: { sortOrder: 'asc' },
      });
      if (scheduleItem) {
        await tx.paymentScheduleItem.update({
          where: { id: scheduleItem.id },
          data: { isPaid: true, paidAt, paymentId: payment.id },
        });
      }

      // Check if fully paid → mark contract COMPLETED and apartment SOLD
      const allPayments = await tx.customerPayment.findMany({
        where: { contractId },
        select: { amountUzs: true },
      });
      const totalPaid = allPayments.reduce((s, p) => s + p.amountUzs, 0n);
      if (totalPaid >= contract.totalPriceUzs) {
        await tx.contract.update({
          where: { id: contractId },
          data: { status: 'COMPLETED' },
        });
        await tx.apartmentUnit.update({
          where: { id: contract.apartmentId },
          data: { status: ApartmentStatus.SOLD },
        });
      }
    });

    await this.audit(
      projectId,
      'PAYMENT',
      contractId,
      'CREATED',
      `Платёж ${amountUzs.toLocaleString('ru-RU')} сум (${dto.method ?? 'CASH'}) по договору №${contract.number}`,
      developerId,
    );

    return this.findOne(projectId, contractId, developerId);
  }

  /** Edit a payment (fix sales-team mistakes: amount, date, comment). */
  async updatePayment(
    projectId: number,
    contractId: number,
    paymentId: number,
    developerId: number,
    dto: { amountUzs?: number; paidAt?: string; comment?: string | null },
  ) {
    await this.assertMember(projectId, developerId);
    const payment = await this.prisma.customerPayment.findFirst({
      where: { id: paymentId, contractId, contract: { projectId } },
    });
    if (!payment) throw new NotFoundException('Payment not found');

    await this.prisma.customerPayment.update({
      where: { id: paymentId },
      data: {
        ...(dto.amountUzs != null
          ? { amountUzs: BigInt(Math.round(dto.amountUzs)) }
          : {}),
        ...(dto.paidAt ? { paidAt: new Date(dto.paidAt) } : {}),
        ...(dto.comment !== undefined ? { comment: dto.comment } : {}),
      },
    });

    if (dto.amountUzs != null && BigInt(Math.round(dto.amountUzs)) !== payment.amountUzs) {
      await this.audit(
        projectId,
        'PAYMENT',
        paymentId,
        'UPDATED',
        `Платёж изменён: ${payment.amountUzs.toLocaleString('ru-RU')} → ${Math.round(dto.amountUzs).toLocaleString('ru-RU')} сум`,
        developerId,
        { before: payment.amountUzs.toString(), after: Math.round(dto.amountUzs) },
      );
    } else {
      await this.audit(
        projectId,
        'PAYMENT',
        paymentId,
        'UPDATED',
        `Платёж от ${payment.paidAt.toLocaleDateString('ru-RU')} отредактирован (дата/комментарий)`,
        developerId,
      );
    }

    return this.findOne(projectId, contractId, developerId);
  }

  /** Manually edit a schedule row (e.g. 11 months of X and a big final payment). */
  async updateScheduleItem(
    projectId: number,
    contractId: number,
    itemId: number,
    developerId: number,
    dto: { amountUzs?: number; dueDate?: string },
  ) {
    await this.assertMember(projectId, developerId);
    const item = await this.prisma.paymentScheduleItem.findFirst({
      where: { id: itemId, contractId, contract: { projectId } },
    });
    if (!item) throw new NotFoundException('Schedule item not found');

    await this.prisma.paymentScheduleItem.update({
      where: { id: itemId },
      data: {
        ...(dto.amountUzs != null
          ? { amountUzs: BigInt(Math.round(dto.amountUzs)) }
          : {}),
        ...(dto.dueDate ? { dueDate: new Date(dto.dueDate) } : {}),
      },
    });

    await this.audit(
      projectId,
      'SCHEDULE',
      itemId,
      'UPDATED',
      `График: платёж от ${item.dueDate.toLocaleDateString('ru-RU')} изменён` +
        (dto.amountUzs != null
          ? ` (${item.amountUzs.toLocaleString('ru-RU')} → ${Math.round(dto.amountUzs).toLocaleString('ru-RU')} сум)`
          : ''),
      developerId,
    );

    return this.findOne(projectId, contractId, developerId);
  }

  async removePayment(
    projectId: number,
    contractId: number,
    paymentId: number,
    developerId: number,
  ) {
    await this.assertMember(projectId, developerId);

    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, projectId },
    });
    if (!contract) throw new NotFoundException('Contract not found');

    const pay = await this.prisma.customerPayment.findFirst({
      where: { id: paymentId, contractId },
    });

    await this.prisma.$transaction(async (tx) => {
      // Unlink schedule item
      await tx.paymentScheduleItem.updateMany({
        where: { contractId, paymentId },
        data: { isPaid: false, paidAt: null, paymentId: null },
      });
      await tx.customerPayment.delete({ where: { id: paymentId } });
    });

    if (pay) {
      await this.audit(
        projectId,
        'PAYMENT',
        paymentId,
        'DELETED',
        `Удалён платёж ${pay.amountUzs.toLocaleString('ru-RU')} сум от ${pay.paidAt.toLocaleDateString('ru-RU')} (договор №${contract.number})`,
        developerId,
      );
    }

    return this.findOne(projectId, contractId, developerId);
  }

  /**
   * Расторжение договора / отмена рассрочки с возвратом средств.
   * Возврат записывается отрицательным платежом (уменьшает кассу и прибыль),
   * квартира освобождается, договор помечается CANCELED.
   */
  async cancelWithRefund(
    projectId: number,
    contractId: number,
    developerId: number,
    dto: {
      refundUzs?: number;
      method?: 'CASH' | 'P2P' | 'BANK';
      reason?: string;
    },
  ) {
    await this.assertMember(projectId, developerId);
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, projectId },
      include: { payments: { select: { amountUzs: true } } },
    });
    if (!contract) throw new NotFoundException('Contract not found');
    if (contract.status === 'CANCELED') {
      throw new BadRequestException('Договор уже расторгнут');
    }

    const paid = contract.payments.reduce((s, p) => s + p.amountUzs, 0n);
    const refund = BigInt(Math.max(0, Math.round(dto.refundUzs ?? 0)));
    if (refund > paid) {
      throw new BadRequestException(
        `Возврат не может превышать оплаченную сумму (${paid.toLocaleString('ru-RU')} сум)`,
      );
    }
    const method = (['CASH', 'P2P', 'BANK'] as const).includes(
      dto.method as 'CASH' | 'P2P' | 'BANK',
    )
      ? (dto.method as 'CASH' | 'P2P' | 'BANK')
      : 'CASH';

    await this.prisma.$transaction(async (tx) => {
      await tx.contract.update({
        where: { id: contractId },
        data: { status: 'CANCELED' },
      });
      await tx.apartmentUnit.update({
        where: { id: contract.apartmentId },
        data: { status: ApartmentStatus.AVAILABLE },
      });
      if (refund > 0n) {
        // отрицательный платёж = возврат из кассы
        await tx.customerPayment.create({
          data: {
            customerId: contract.customerId,
            contractId,
            amountUzs: -refund,
            paidAt: new Date(),
            type: 'OTHER',
            method,
            comment: `Возврат при расторжении${dto.reason ? ': ' + dto.reason.trim() : ''}`,
          },
        });
      }
    });

    await this.audit(
      projectId,
      'CONTRACT',
      contractId,
      'UPDATED',
      `Договор №${contract.number} расторгнут` +
        (refund > 0n
          ? `, возврат ${refund.toLocaleString('ru-RU')} сум (${method})`
          : ' без возврата') +
        (dto.reason ? `. Причина: ${dto.reason.trim()}` : ''),
      developerId,
    );

    return this.findOne(projectId, contractId, developerId);
  }

  // ── Stats for reports ─────────────────────────────────────────────────────

  async getProjectStats(projectId: number, developerId: number) {
    await this.assertMember(projectId, developerId);

    const [contracts, apartments, payAgg] = await Promise.all([
      this.prisma.contract.findMany({
        where: { projectId },
        select: {
          status: true,
          totalPriceUzs: true,
          paymentMethod: true,
          contractDate: true,
          managerId: true,
          manager: { select: { id: true, name: true } },
          payments: { select: { amountUzs: true } },
        },
      }),
      this.prisma.apartmentUnit.groupBy({
        by: ['status'],
        where: { projectId },
        _count: true,
      }),
      this.prisma.customerPayment.groupBy({
        by: ['method'],
        where: { customer: { projectId } },
        _sum: { amountUzs: true },
      }),
    ]);

    const totalSalesUzs = contracts
      .filter((c) => c.status !== 'CANCELED')
      .reduce((s, c) => s + c.totalPriceUzs, 0n);

    const totalCollectedUzs = contracts
      .filter((c) => c.status !== 'CANCELED')
      .reduce(
        (s, c) => s + c.payments.reduce((ps, p) => ps + p.amountUzs, 0n),
        0n,
      );

    const totalDebtUzs = totalSalesUzs - totalCollectedUzs;

    const byStatus = apartments.reduce(
      (acc, a) => {
        acc[a.status] = a._count;
        return acc;
      },
      {} as Record<string, number>,
    );

    // Sales by manager
    const managerMap = new Map<
      number,
      { name: string; count: number; totalUzs: bigint }
    >();
    for (const c of contracts) {
      if (!c.managerId || c.status === 'CANCELED') continue;
      const entry = managerMap.get(c.managerId) ?? {
        name: c.manager?.name ?? 'Unknown',
        count: 0,
        totalUzs: 0n,
      };
      entry.count++;
      entry.totalUzs += c.totalPriceUzs;
      managerMap.set(c.managerId, entry);
    }

    // Продажи по месяцам (последние 6)
    const now = new Date();
    const months: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      );
    }
    const msMap = new Map<string, { count: number; sum: bigint }>(
      months.map((m) => [m, { count: 0, sum: 0n }]),
    );
    for (const c of contracts) {
      if (c.status === 'CANCELED' || !c.contractDate) continue;
      const k = `${c.contractDate.getFullYear()}-${String(c.contractDate.getMonth() + 1).padStart(2, '0')}`;
      const e = msMap.get(k);
      if (e) {
        e.count++;
        e.sum += c.totalPriceUzs;
      }
    }
    const monthlySales = months.map((m) => ({
      month: m,
      count: msMap.get(m)!.count,
      sumUzs: msMap.get(m)!.sum.toString(),
    }));

    // Сборы по кассам (способ оплаты), net (возвраты уменьшают)
    const paymentMethods: Record<string, string> = {
      CASH: '0',
      P2P: '0',
      BANK: '0',
    };
    for (const p of payAgg) {
      paymentMethods[p.method] = (p._sum.amountUzs ?? 0n).toString();
    }

    return {
      totalSalesUzs: totalSalesUzs.toString(),
      totalCollectedUzs: totalCollectedUzs.toString(),
      totalDebtUzs: totalDebtUzs.toString(),
      contractsCount: contracts.filter((c) => c.status !== 'CANCELED').length,
      apartmentsByStatus: byStatus,
      salesByManager: Array.from(managerMap.entries()).map(([id, v]) => ({
        managerId: id,
        name: v.name,
        count: v.count,
        totalUzs: v.totalUzs.toString(),
      })),
      monthlySales,
      paymentMethods,
    };
  }

  // ── Upcoming payments forecast ────────────────────────────────────────────

  async getPaymentForecast(projectId: number, developerId: number, months = 6) {
    await this.assertMember(projectId, developerId);

    const now = new Date();
    const until = new Date(now);
    until.setMonth(until.getMonth() + months);

    const items = await this.prisma.paymentScheduleItem.findMany({
      where: {
        contract: { projectId, status: { in: ['ACTIVE', 'BOOKED'] } },
        isPaid: false,
        dueDate: { gte: now, lte: until },
      },
      orderBy: { dueDate: 'asc' },
      select: { dueDate: true, amountUzs: true },
    });

    // Group by month
    const byMonth = new Map<string, bigint>();
    for (const item of items) {
      const key = `${item.dueDate.getFullYear()}-${String(item.dueDate.getMonth() + 1).padStart(2, '0')}`;
      byMonth.set(key, (byMonth.get(key) ?? 0n) + item.amountUzs);
    }

    return Array.from(byMonth.entries()).map(([month, amountUzs]) => ({
      month,
      amountUzs: amountUzs.toString(),
    }));
  }
}
