import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PayMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

const METHODS: PayMethod[] = ['CASH', 'CARD', 'P2P', 'BANK'];

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertMember(projectId: number, developerId: number) {
    const member = await this.prisma.projectMember.findFirst({
      where: { projectId, developerId },
    });
    if (!member) throw new ForbiddenException('No access to this project');
  }

  /** Запись в журнал изменений (используется и другими модулями). */
  async log(
    projectId: number,
    entity: string,
    entityId: number,
    action: string,
    summary: string,
    developerId?: number | null,
    details?: unknown,
  ) {
    await this.prisma.auditLog.create({
      data: {
        projectId,
        entity,
        entityId,
        action,
        summary,
        developerId: developerId ?? null,
        details: details === undefined ? undefined : (details as Prisma.InputJsonValue),
      },
    });
  }

  // ── Сводка: кассы + доходы/расходы/прибыль ─────────────────────────────────

  async summary(projectId: number, developerId: number) {
    await this.assertMember(projectId, developerId);

    const [payments, expenses, transfers] = await Promise.all([
      this.prisma.customerPayment.groupBy({
        by: ['method'],
        where: { customer: { projectId } },
        _sum: { amountUzs: true },
      }),
      this.prisma.expense.groupBy({
        by: ['method'],
        where: { projectId },
        _sum: { amountUzs: true },
      }),
      this.prisma.cashTransfer.findMany({
        where: { projectId },
        select: { fromMethod: true, toMethod: true, amountUzs: true },
      }),
    ]);

    const kassa: Record<string, { income: string; expense: string; balance: string }> = {};
    const inc = new Map<PayMethod, bigint>();
    const exp = new Map<PayMethod, bigint>();
    for (const p of payments) inc.set(p.method, p._sum.amountUzs ?? 0n);
    for (const e of expenses) exp.set(e.method, e._sum.amountUzs ?? 0n);
    const trIn = new Map<PayMethod, bigint>();
    const trOut = new Map<PayMethod, bigint>();
    for (const t of transfers) {
      trOut.set(t.fromMethod, (trOut.get(t.fromMethod) ?? 0n) + t.amountUzs);
      trIn.set(t.toMethod, (trIn.get(t.toMethod) ?? 0n) + t.amountUzs);
    }

    let totalIncome = 0n;
    let totalExpense = 0n;
    for (const m of METHODS) {
      const i = inc.get(m) ?? 0n;
      const e = exp.get(m) ?? 0n;
      totalIncome += i;
      totalExpense += e;
      const balance = i - e + (trIn.get(m) ?? 0n) - (trOut.get(m) ?? 0n);
      kassa[m] = {
        income: i.toString(),
        expense: e.toString(),
        balance: balance.toString(),
      };
    }

    return {
      kassa,
      totalIncome: totalIncome.toString(),
      totalExpense: totalExpense.toString(),
      profit: (totalIncome - totalExpense).toString(),
    };
  }

  // ── Расходы ─────────────────────────────────────────────────────────────────

  async listExpenses(projectId: number, developerId: number) {
    await this.assertMember(projectId, developerId);
    return this.prisma.expense.findMany({
      where: { projectId },
      orderBy: { spentAt: 'desc' },
      take: 300,
    });
  }

  async addExpense(
    projectId: number,
    developerId: number,
    dto: {
      title: string;
      category?: string;
      amountUzs: number;
      method?: string;
      spentAt?: string;
      comment?: string;
    },
  ) {
    await this.assertMember(projectId, developerId);
    if (!dto.title?.trim()) throw new BadRequestException('Укажите назначение расхода');
    if (!dto.amountUzs || dto.amountUzs <= 0)
      throw new BadRequestException('Сумма должна быть больше нуля');
    const method = METHODS.includes(dto.method as PayMethod)
      ? (dto.method as PayMethod)
      : 'CASH';

    const exp = await this.prisma.expense.create({
      data: {
        projectId,
        title: dto.title.trim(),
        category: dto.category?.trim() || 'Прочее',
        amountUzs: BigInt(Math.round(dto.amountUzs)),
        method,
        spentAt: dto.spentAt ? new Date(dto.spentAt) : new Date(),
        comment: dto.comment?.trim() || null,
        createdBy: developerId,
      },
    });
    await this.log(
      projectId,
      'EXPENSE',
      exp.id,
      'CREATED',
      `Расход «${exp.title}» на ${exp.amountUzs.toLocaleString('ru-RU')} сум`,
      developerId,
    );
    return exp;
  }

  async removeExpense(projectId: number, developerId: number, id: number) {
    await this.assertMember(projectId, developerId);
    const exp = await this.prisma.expense.findFirst({ where: { id, projectId } });
    if (!exp) throw new NotFoundException('Расход не найден');
    await this.prisma.expense.delete({ where: { id } });
    await this.log(
      projectId,
      'EXPENSE',
      id,
      'DELETED',
      `Удалён расход «${exp.title}» на ${exp.amountUzs.toLocaleString('ru-RU')} сум`,
      developerId,
    );
    return { ok: true };
  }

  // ── Переводы между кассами ──────────────────────────────────────────────────

  async listTransfers(projectId: number, developerId: number) {
    await this.assertMember(projectId, developerId);
    return this.prisma.cashTransfer.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async transfer(
    projectId: number,
    developerId: number,
    dto: { fromMethod: string; toMethod: string; amountUzs: number; comment?: string },
  ) {
    await this.assertMember(projectId, developerId);
    const from = dto.fromMethod as PayMethod;
    const to = dto.toMethod as PayMethod;
    if (!METHODS.includes(from) || !METHODS.includes(to) || from === to)
      throw new BadRequestException('Выберите разные кассы');
    if (!dto.amountUzs || dto.amountUzs <= 0)
      throw new BadRequestException('Сумма должна быть больше нуля');

    const tr = await this.prisma.cashTransfer.create({
      data: {
        projectId,
        fromMethod: from,
        toMethod: to,
        amountUzs: BigInt(Math.round(dto.amountUzs)),
        comment: dto.comment?.trim() || null,
        createdBy: developerId,
      },
    });
    await this.log(
      projectId,
      'TRANSFER',
      tr.id,
      'CREATED',
      `Перевод между кассами: ${from} → ${to}, ${tr.amountUzs.toLocaleString('ru-RU')} сум`,
      developerId,
    );
    return tr;
  }

  // ── Должники (aging) ────────────────────────────────────────────────────────

  async debtors(projectId: number, developerId: number) {
    await this.assertMember(projectId, developerId);
    const now = new Date();
    const contracts = await this.prisma.contract.findMany({
      where: { projectId, status: { in: ['ACTIVE', 'BOOKED'] } },
      select: {
        id: true,
        number: true,
        totalPriceUzs: true,
        customer: { select: { id: true, name: true, phone: true } },
        apartment: { select: { number: true, sectionKey: true } },
        payments: { select: { amountUzs: true } },
        paymentSchedule: {
          where: { isPaid: false, dueDate: { lt: now } },
          select: { amountUzs: true, dueDate: true },
          orderBy: { dueDate: 'asc' },
        },
      },
    });

    const buckets = { d30: 0n, d60: 0n, d90: 0n, d90p: 0n };
    const rows = contracts
      .filter((c) => c.paymentSchedule.length > 0)
      .map((c) => {
        const debt = c.paymentSchedule.reduce((s, i) => s + i.amountUzs, 0n);
        const oldest = c.paymentSchedule[0].dueDate;
        const days = Math.floor((now.getTime() - oldest.getTime()) / 86400000);
        const paid = c.payments.reduce((s, p) => s + p.amountUzs, 0n);
        if (days <= 30) buckets.d30 += debt;
        else if (days <= 60) buckets.d60 += debt;
        else if (days <= 90) buckets.d90 += debt;
        else buckets.d90p += debt;
        return {
          contractId: c.id,
          number: c.number,
          customer: c.customer,
          apartment: `${c.apartment.sectionKey ? c.apartment.sectionKey + '-' : ''}${c.apartment.number}`,
          debtUzs: debt.toString(),
          overdueDays: days,
          paidUzs: paid.toString(),
          totalUzs: c.totalPriceUzs.toString(),
        };
      })
      .sort((a, b) => b.overdueDays - a.overdueDays);

    return {
      buckets: {
        d30: buckets.d30.toString(),
        d60: buckets.d60.toString(),
        d90: buckets.d90.toString(),
        d90p: buckets.d90p.toString(),
      },
      totalDebt: (buckets.d30 + buckets.d60 + buckets.d90 + buckets.d90p).toString(),
      count: rows.length,
      rows,
    };
  }

  // ── Доходы (список платежей проекта) ───────────────────────────────────────

  async income(projectId: number, developerId: number) {
    await this.assertMember(projectId, developerId);
    return this.prisma.customerPayment.findMany({
      where: { customer: { projectId } },
      orderBy: { paidAt: 'desc' },
      take: 300,
      select: {
        id: true,
        amountUzs: true,
        paidAt: true,
        method: true,
        type: true,
        comment: true,
        customer: { select: { id: true, name: true } },
        contract: { select: { id: true, number: true } },
      },
    });
  }

  // ── История изменений ───────────────────────────────────────────────────────

  async audit(projectId: number, developerId: number) {
    await this.assertMember(projectId, developerId);
    return this.prisma.auditLog.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        entity: true,
        entityId: true,
        action: true,
        summary: true,
        details: true,
        createdAt: true,
        developer: { select: { id: true, name: true } },
      },
    });
  }
}
