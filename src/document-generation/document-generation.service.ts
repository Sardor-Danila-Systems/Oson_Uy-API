import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import * as PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';

export type DocLang = 'uz' | 'uz_cyrillic' | 'ru';
export type DocType = 'CONTRACT' | 'GUARANTEE_LETTER' | 'PAYMENT_SCHEDULE';

@Injectable()
export class DocumentGenerationService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Template helpers ──────────────────────────────────────────────────────

  private formatUzs(value: bigint | null | undefined): string {
    if (value == null) return '0';
    return value.toLocaleString('ru-RU');
  }

  private formatDate(date: Date | string | null | undefined): string {
    if (!date) return '';
    return new Date(date).toLocaleDateString('ru-RU');
  }

  private async fetchBuffer(url: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      client.get(url, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      });
    });
  }

  private async getTemplateBuffer(
    projectId: number | null | undefined,
    type: DocType,
    lang: DocLang,
  ): Promise<Buffer> {
    // 1. Check project-specific template
    if (projectId) {
      const tmpl = await this.prisma.contractTemplate.findFirst({
        where: { projectId, type, language: lang },
        orderBy: { isDefault: 'desc' },
      });
      if (tmpl) return this.fetchBuffer(tmpl.templateUrl);
    }

    // 2. Fallback to global template
    const global = await this.prisma.contractTemplate.findFirst({
      where: { projectId: null, type, language: lang },
      orderBy: { isDefault: 'desc' },
    });
    if (global) return this.fetchBuffer(global.templateUrl);

    // 3. Fallback to local file template
    const fileName = `${type.toLowerCase()}_${lang}.docx`;
    const localPath = path.join(
      __dirname,
      '..',
      '..',
      'templates',
      fileName,
    );
    if (fs.existsSync(localPath)) {
      return fs.readFileSync(localPath);
    }

    throw new NotFoundException(
      `Template not found: type=${type}, lang=${lang}`,
    );
  }

  // ── Contract data builder ─────────────────────────────────────────────────

  private async buildContractData(contractId: number) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: {
        project: {
          select: {
            name: true,
            location: true,
            developer: {
              select: {
                name: true,
                phone: true,
                legalAddress: true,
                officeAddress: true,
              },
            },
          },
        },
        apartment: {
          select: {
            number: true,
            floor: true,
            sectionKey: true,
            rooms: true,
            areaSqm: true,
            priceUzs: true,
            pricePerM2Uzs: true,
            renovationState: true,
          },
        },
        customer: true,
        manager: { select: { name: true, phone: true } },
        payments: { orderBy: { paidAt: 'asc' } },
        paymentSchedule: { orderBy: { sortOrder: 'asc' } },
      },
    });

    if (!contract) throw new NotFoundException('Contract not found');

    const paidUzs = contract.payments.reduce((s, p) => s + p.amountUzs, 0n);
    const remainingUzs = contract.totalPriceUzs - paidUzs;

    return {
      // Contract
      contract_number: contract.number,
      contract_date: this.formatDate(contract.contractDate),
      contract_status: contract.status,
      payment_method: contract.paymentMethod,
      term_months: contract.termMonths,
      discount_percent: contract.discountPercent,

      // Prices
      total_price: this.formatUzs(contract.totalPriceUzs),
      first_payment: this.formatUzs(contract.firstPaymentUzs),
      monthly_payment: this.formatUzs(contract.monthlyAmountUzs),
      paid_amount: this.formatUzs(paidUzs),
      remaining_amount: this.formatUzs(remainingUzs),

      // Project
      project_name: contract.project.name,
      project_location: contract.project.location,
      developer_name: contract.project.developer.name,
      developer_phone: contract.project.developer.phone ?? '',
      developer_legal_address: contract.project.developer.legalAddress ?? '',
      developer_office_address: contract.project.developer.officeAddress ?? '',

      // Apartment
      apartment_number: contract.apartment.number,
      apartment_floor: contract.apartment.floor,
      apartment_block: contract.apartment.sectionKey,
      apartment_rooms: contract.apartment.rooms,
      apartment_area: contract.apartment.areaSqm,
      apartment_price_per_m2: this.formatUzs(contract.apartment.pricePerM2Uzs),
      apartment_total_price: this.formatUzs(contract.apartment.priceUzs),
      apartment_renovation: contract.apartment.renovationState,

      // Customer
      customer_name: contract.customer.name,
      customer_phone: contract.customer.phone,
      customer_passport_series: contract.customer.passportSeries ?? '',
      customer_passport_number: contract.customer.passportNumber ?? '',
      customer_passport_issued_by: contract.customer.passportIssuedBy ?? '',
      customer_passport_issued_at: this.formatDate(contract.customer.passportIssuedAt),
      customer_pinfl: contract.customer.pinfl ?? '',
      customer_birth_date: this.formatDate(contract.customer.birthDate),
      customer_address: contract.customer.address ?? '',
      customer_city: contract.customer.city ?? '',
      customer_region: contract.customer.region ?? '',

      // Manager
      manager_name: contract.manager?.name ?? '',
      manager_phone: contract.manager?.phone ?? '',

      // Payment schedule table rows
      schedule_rows: contract.paymentSchedule.map((item, i) => ({
        row_num: i + 1,
        due_date: this.formatDate(item.dueDate),
        amount: this.formatUzs(item.amountUzs),
        is_paid: item.isPaid ? 'Оплачено' : '',
        paid_at: item.isPaid ? this.formatDate(item.paidAt) : '',
      })),

      // Payment history
      payment_rows: contract.payments.map((p, i) => ({
        row_num: i + 1,
        paid_date: this.formatDate(p.paidAt),
        amount: this.formatUzs(p.amountUzs),
        type: p.type,
        comment: p.comment ?? '',
      })),
    };
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async generateContractDocx(
    contractId: number,
    lang: DocLang = 'uz',
  ): Promise<Buffer> {
    const data = await this.buildContractData(contractId);
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      select: { projectId: true },
    });

    const templateBuffer = await this.getTemplateBuffer(
      contract?.projectId,
      'CONTRACT',
      lang,
    );

    return this.renderDocx(templateBuffer, data);
  }

  async generateGuaranteeLetterDocx(
    contractId: number,
    lang: DocLang = 'uz',
  ): Promise<Buffer> {
    const data = await this.buildContractData(contractId);
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      select: { projectId: true },
    });

    const templateBuffer = await this.getTemplateBuffer(
      contract?.projectId,
      'GUARANTEE_LETTER',
      lang,
    );

    return this.renderDocx(templateBuffer, data);
  }

  async generatePaymentScheduleDocx(
    contractId: number,
    lang: DocLang = 'uz',
  ): Promise<Buffer> {
    const data = await this.buildContractData(contractId);
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      select: { projectId: true },
    });

    const templateBuffer = await this.getTemplateBuffer(
      contract?.projectId,
      'PAYMENT_SCHEDULE',
      lang,
    );

    return this.renderDocx(templateBuffer, data);
  }

  private renderDocx(templateBuffer: Buffer, data: object): Buffer {
    try {
      const zip = new PizZip(templateBuffer);
      const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
      });
      doc.render(data);
      return doc.getZip().generate({ type: 'nodebuffer' }) as Buffer;
    } catch (err) {
      throw new InternalServerErrorException(
        `Document generation failed: ${(err as Error).message}`,
      );
    }
  }
}
