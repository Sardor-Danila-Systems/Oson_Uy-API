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

  private generateSchedule(
    contractId: number,
    totalPriceUzs: bigint,
    firstPaymentUzs: bigint,
    termMonths: number,
    contractDate: Date,
  ) {
    const remaining = totalPriceUzs - firstPaymentUzs;
    if (remaining <= 0n || termMonths <= 1) return [];

    const monthly = remaining / BigInt(termMonths);
    const lastExtra = remaining - monthly * BigInt(termMonths);

    return Array.from({ length: termMonths }, (_, i) => {
      const dueDate = new Date(contractDate);
      dueDate.setMonth(dueDate.getMonth() + i + 1);
      return {
        contractId,
        dueDate,
        amountUzs: i === termMonths - 1 ? monthly + lastExtra : monthly,
        sortOrder: i + 1,
      };
    });
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

    await this.prisma.$transaction(async (tx) => {
      await tx.contract.update({ where: { id: contractId }, data });

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

    await this.prisma.$transaction(async (tx) => {
      // Unlink schedule item
      await tx.paymentScheduleItem.updateMany({
        where: { contractId, paymentId },
        data: { isPaid: false, paidAt: null, paymentId: null },
      });
      await tx.customerPayment.delete({ where: { id: paymentId } });
    });

    return this.findOne(projectId, contractId, developerId);
  }

  // ── Stats for reports ─────────────────────────────────────────────────────

  async getProjectStats(projectId: number, developerId: number) {
    await this.assertMember(projectId, developerId);

    const [contracts, apartments] = await Promise.all([
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
