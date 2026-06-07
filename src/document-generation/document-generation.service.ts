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
    // 1. Project template in the requested language
    if (projectId) {
      const tmpl = await this.prisma.contractTemplate.findFirst({
        where: { projectId, type, language: lang },
        orderBy: { isDefault: 'desc' },
      });
      if (tmpl) return this.fetchBuffer(tmpl.templateUrl);

      // 1b. Project template of this type in any language
      const anyLang = await this.prisma.contractTemplate.findFirst({
        where: { projectId, type },
        orderBy: { isDefault: 'desc' },
      });
      if (anyLang) return this.fetchBuffer(anyLang.templateUrl);
    }

    // 2. Global template (requested language, then any language)
    const global = await this.prisma.contractTemplate.findFirst({
      where: { projectId: null, type, language: lang },
      orderBy: { isDefault: 'desc' },
    });
    if (global) return this.fetchBuffer(global.templateUrl);

    const globalAny = await this.prisma.contractTemplate.findFirst({
      where: { projectId: null, type },
      orderBy: { isDefault: 'desc' },
    });
    if (globalAny) return this.fetchBuffer(globalAny.templateUrl);

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
      'Шаблон документа не загружен. Загрузите образец (.docx) в разделе «Договоры → Шаблоны».',
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
      payment_day: contract.paymentDay ?? '',
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

  /**
   * Catalog of placeholders a developer can use inside their .docx template.
   * Placeholders use single curly braces, e.g. {customer_name}.
   */
  getAvailableVariables(): { key: string; label: string }[] {
    return [
      { key: 'contract_number', label: 'Номер договора' },
      { key: 'contract_date', label: 'Дата договора' },
      { key: 'payment_method', label: 'Способ оплаты' },
      { key: 'term_months', label: 'Срок (мес.)' },
      { key: 'payment_day', label: 'День платежа (число месяца)' },
      { key: 'discount_percent', label: 'Скидка (%)' },
      { key: 'total_price', label: 'Сумма договора' },
      { key: 'first_payment', label: 'Первоначальный взнос' },
      { key: 'monthly_payment', label: 'Ежемесячный платёж' },
      { key: 'paid_amount', label: 'Оплачено' },
      { key: 'remaining_amount', label: 'Остаток' },
      { key: 'project_name', label: 'Название ЖК' },
      { key: 'project_location', label: 'Адрес ЖК' },
      { key: 'developer_name', label: 'Застройщик' },
      { key: 'developer_phone', label: 'Телефон застройщика' },
      { key: 'developer_legal_address', label: 'Юр. адрес застройщика' },
      { key: 'developer_office_address', label: 'Офис застройщика' },
      { key: 'apartment_number', label: 'Номер квартиры' },
      { key: 'apartment_floor', label: 'Этаж' },
      { key: 'apartment_block', label: 'Блок / секция' },
      { key: 'apartment_rooms', label: 'Комнат' },
      { key: 'apartment_area', label: 'Площадь (м²)' },
      { key: 'apartment_price_per_m2', label: 'Цена за м²' },
      { key: 'apartment_total_price', label: 'Стоимость квартиры' },
      { key: 'customer_name', label: 'ФИО покупателя' },
      { key: 'customer_phone', label: 'Телефон покупателя' },
      { key: 'customer_passport_series', label: 'Серия паспорта' },
      { key: 'customer_passport_number', label: 'Номер паспорта' },
      { key: 'customer_passport_issued_by', label: 'Паспорт выдан' },
      { key: 'customer_pinfl', label: 'ПИНФЛ' },
      { key: 'customer_birth_date', label: 'Дата рождения' },
      { key: 'customer_address', label: 'Адрес покупателя' },
      { key: 'customer_city', label: 'Город' },
      { key: 'customer_region', label: 'Регион' },
      { key: 'manager_name', label: 'Менеджер' },
      { key: 'manager_phone', label: 'Телефон менеджера' },
    ];
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
        // Render unknown / typo'd placeholders as empty instead of throwing,
        // so an imperfect developer template still produces a document.
        nullGetter: () => '',
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
