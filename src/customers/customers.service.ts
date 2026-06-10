import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../prisma.service';
import { normalizePhone } from '../common/utils/phone';
import { ApartmentsService } from '../apartments/apartments.service';
import { APARTMENT_UNIT_LAYOUT_INCLUDE } from '../apartments/apartment-unit.include';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { FilterCustomerDto } from './dto/filter-customer.dto';
import { CreateCustomerPaymentDto } from './dto/create-customer-payment.dto';
import { UpdateCustomerPaymentDto } from './dto/update-customer-payment.dto';
import { CreateCustomerDocumentDto } from './dto/create-customer-document.dto';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly apartmentsService: ApartmentsService,
  ) {}

  private async newAccessCode(): Promise<string> {
    for (let i = 0; i < 10; i++) {
      const code = randomBytes(6).toString('hex').toUpperCase();
      const taken = await this.prisma.customer.findUnique({
        where: { accessCode: code },
        select: { id: true },
      });
      if (!taken) return code;
    }
    throw new BadRequestException('Could not allocate access code');
  }

  async list(projectId: number, developerId: number, query: FilterCustomerDto) {
    await this.apartmentsService.assertProjectMember(projectId, developerId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;
    const search = query.search?.trim();

    const where: Prisma.CustomerWhereInput = {
      projectId,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search.replace(/\D/g, '') } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        include: {
          apartment: {
            select: {
              id: true,
              number: true,
              floor: true,
              sectionKey: true,
              rooms: true,
              areaSqm: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.customer.count({ where }),
    ]);

    // Attach contract finance (paid / remaining / overdue debt) per customer
    const customerIds = items.map((c) => c.id);
    const contracts = customerIds.length
      ? await this.prisma.contract.findMany({
          where: {
            projectId,
            customerId: { in: customerIds },
            status: { not: 'CANCELED' },
          },
          orderBy: { contractDate: 'desc' },
          select: {
            id: true,
            number: true,
            customerId: true,
            status: true,
            totalPriceUzs: true,
            payments: { select: { amountUzs: true } },
            paymentSchedule: {
              select: { isPaid: true, dueDate: true, amountUzs: true },
            },
          },
        })
      : [];

    const now = new Date();
    const financeByCustomer = new Map<
      number,
      {
        contractId: number;
        contractNumber: string;
        status: string;
        totalPriceUzs: bigint;
        paidUzs: bigint;
        remainingUzs: bigint;
        debtUzs: bigint;
      }
    >();
    for (const c of contracts) {
      if (financeByCustomer.has(c.customerId)) continue; // latest only
      const paid = c.payments.reduce((s, p) => s + p.amountUzs, 0n);
      const remaining = c.totalPriceUzs - paid;
      const debt = c.paymentSchedule
        .filter((s) => !s.isPaid && new Date(s.dueDate) < now)
        .reduce((s, i) => s + i.amountUzs, 0n);
      financeByCustomer.set(c.customerId, {
        contractId: c.id,
        contractNumber: c.number,
        status: c.status,
        totalPriceUzs: c.totalPriceUzs,
        paidUzs: paid,
        remainingUzs: remaining,
        debtUzs: debt,
      });
    }

    const enriched = items.map((c) => ({
      ...c,
      finance: financeByCustomer.get(c.id) ?? null,
    }));

    return { items: enriched, total, page, limit };
  }

  async create(
    projectId: number,
    dto: CreateCustomerDto,
    developerId: number,
  ) {
    await this.apartmentsService.assertProjectMember(projectId, developerId);
    const phone = normalizePhone(dto.phone);
    if (!phone) throw new BadRequestException('Invalid phone');

    let apartmentId: number | null = dto.apartmentId ?? null;
    if (apartmentId != null) {
      const apt = await this.prisma.apartmentUnit.findFirst({
        where: { id: apartmentId, projectId },
      });
      if (!apt) throw new BadRequestException('Apartment not in this project');
    }

    const accessCode = await this.newAccessCode();
    const verificationToken = randomUUID();

    const customer = await this.prisma.customer.create({
      data: {
        projectId,
        apartmentId,
        name: dto.name.trim(),
        phone,
        accessCode,
        verificationToken,
        totalPriceUzs: dto.totalPriceUzs ?? null,
        monthlyDueUzs: dto.monthlyDueUzs ?? null,
        notes: dto.notes?.trim() || null,
        passportSeries: dto.passportSeries?.trim() || null,
        passportNumber: dto.passportNumber?.trim() || null,
        passportIssuedBy: dto.passportIssuedBy?.trim() || null,
        pinfl: dto.pinfl?.trim() || null,
        address: dto.address?.trim() || null,
        city: dto.city?.trim() || null,
        region: dto.region?.trim() || null,
        email: dto.email?.trim() || null,
      },
      include: { apartment: true },
    });

    if (apartmentId != null) {
      await this.prisma.apartmentUnit.update({
        where: { id: apartmentId },
        data: { status: 'RESERVED' },
      });
    }

    return customer;
  }

  async findOne(projectId: number, customerId: number, developerId: number) {
    await this.apartmentsService.assertProjectMember(projectId, developerId);
    const c = await this.prisma.customer.findFirst({
      where: { id: customerId, projectId },
      include: {
        apartment: true,
        payments: { orderBy: { paidAt: 'desc' } },
        documents: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!c) throw new NotFoundException('Customer not found');
    return c;
  }

  async update(
    projectId: number,
    customerId: number,
    dto: UpdateCustomerDto,
    developerId: number,
  ) {
    await this.findOne(projectId, customerId, developerId);
    let apartmentId = dto.apartmentId;
    if (apartmentId !== undefined && apartmentId !== null) {
      const apt = await this.prisma.apartmentUnit.findFirst({
        where: { id: apartmentId, projectId },
      });
      if (!apt) throw new BadRequestException('Apartment not in this project');
    }

    const prev = await this.prisma.customer.findFirst({
      where: { id: customerId, projectId },
    });
    if (!prev) throw new NotFoundException('Customer not found');

    const updated = await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        ...(dto.name != null ? { name: dto.name.trim() } : {}),
        ...(dto.phone != null ? { phone: normalizePhone(dto.phone) } : {}),
        ...(dto.apartmentId !== undefined ? { apartmentId } : {}),
        ...(dto.totalPriceUzs !== undefined
          ? { totalPriceUzs: dto.totalPriceUzs }
          : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(dto.monthlyDueUzs !== undefined
          ? { monthlyDueUzs: dto.monthlyDueUzs }
          : {}),
      },
      include: { apartment: true, payments: true, documents: true },
    });

    if (dto.apartmentId !== undefined && dto.apartmentId !== prev.apartmentId) {
      if (prev.apartmentId != null) {
        await this.prisma.apartmentUnit.update({
          where: { id: prev.apartmentId },
          data: { status: 'AVAILABLE' },
        });
      }
      if (dto.apartmentId != null) {
        await this.prisma.apartmentUnit.update({
          where: { id: dto.apartmentId },
          data: { status: 'RESERVED' },
        });
      }
    }

    return updated;
  }

  async regenerateAccessCode(
    projectId: number,
    customerId: number,
    developerId: number,
  ) {
    await this.findOne(projectId, customerId, developerId);
    const accessCode = await this.newAccessCode();
    return this.prisma.customer.update({
      where: { id: customerId },
      data: { accessCode },
      select: { id: true, accessCode: true },
    });
  }

  async addPayment(
    projectId: number,
    customerId: number,
    dto: CreateCustomerPaymentDto,
    developerId: number,
  ) {
    await this.findOne(projectId, customerId, developerId);
    return this.prisma.customerPayment.create({
      data: {
        customerId,
        amountUzs: dto.amountUzs,
        paidAt: new Date(dto.paidAt),
        comment: dto.comment?.trim() || null,
        type: dto.type ?? 'OTHER',
      },
    });
  }

  async updatePayment(
    projectId: number,
    customerId: number,
    paymentId: number,
    dto: UpdateCustomerPaymentDto,
    developerId: number,
  ) {
    await this.findOne(projectId, customerId, developerId);
    const pay = await this.prisma.customerPayment.findFirst({
      where: { id: paymentId, customerId },
    });
    if (!pay) throw new NotFoundException('Payment not found');
    return this.prisma.customerPayment.update({
      where: { id: paymentId },
      data: {
        ...(dto.amountUzs != null ? { amountUzs: dto.amountUzs } : {}),
        ...(dto.paidAt != null ? { paidAt: new Date(dto.paidAt) } : {}),
        ...(dto.comment !== undefined ? { comment: dto.comment } : {}),
        ...(dto.type != null ? { type: dto.type } : {}),
      },
    });
  }

  async removePayment(
    projectId: number,
    customerId: number,
    paymentId: number,
    developerId: number,
  ) {
    await this.findOne(projectId, customerId, developerId);
    const pay = await this.prisma.customerPayment.findFirst({
      where: { id: paymentId, customerId },
    });
    if (!pay) throw new NotFoundException('Payment not found');
    await this.prisma.customerPayment.delete({ where: { id: paymentId } });
    return { ok: true };
  }

  async addDocument(
    projectId: number,
    customerId: number,
    dto: CreateCustomerDocumentDto,
    developerId: number,
  ) {
    await this.findOne(projectId, customerId, developerId);
    return this.prisma.customerDocument.create({
      data: {
        customerId,
        title: dto.title.trim(),
        fileUrl: dto.fileUrl.trim(),
        mimeType: dto.mimeType?.trim() || null,
        isContract: dto.isContract ?? false,
      },
    });
  }

  async removeDocument(
    projectId: number,
    customerId: number,
    documentId: number,
    developerId: number,
  ) {
    await this.findOne(projectId, customerId, developerId);
    const doc = await this.prisma.customerDocument.findFirst({
      where: { id: documentId, customerId },
    });
    if (!doc) throw new NotFoundException('Document not found');
    await this.prisma.customerDocument.delete({ where: { id: documentId } });
    return { ok: true };
  }

  /** Buyer cabinet — full snapshot */
  async getCabinetSnapshot(customerId: number) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        project: { include: { developer: { select: { id: true, name: true } } } },
        apartment: { include: APARTMENT_UNIT_LAYOUT_INCLUDE },
        payments: { orderBy: { paidAt: 'desc' } },
        documents: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const milestones = await this.prisma.projectProgressMilestone.findMany({
      where: { projectId: customer.projectId },
      orderBy: { sortOrder: 'asc' },
    });

    const total = Number(
      customer.totalPriceUzs ?? customer.apartment?.priceUzs ?? 0,
    );
    const paid = customer.payments.reduce(
      (s, p) => s + Number(p.amountUzs),
      0,
    );
    const remaining = Math.max(0, total - paid);

    return {
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        verificationToken: customer.verificationToken,
      },
      project: {
        id: customer.project.id,
        name: customer.project.name,
        location: customer.project.location,
        developerName: customer.project.developer?.name,
      },
      apartment: customer.apartment
        ? this.apartmentsService.serializeUnit(customer.apartment)
        : null,
      finances: {
        totalPriceUzs: total,
        paidUzs: paid,
        remainingUzs: remaining,
        debtUzs: remaining,
        monthlyDueUzs: customer.monthlyDueUzs,
      },
      payments: customer.payments,
      documents: customer.documents,
      progress: {
        milestones: milestones.map((m) => ({
          id: m.id,
          title: m.title,
          done: m.done,
          sortOrder: m.sortOrder,
          photoUrls: (m as { photoUrls?: string[] }).photoUrls ?? [],
        })),
      },
    };
  }

}
