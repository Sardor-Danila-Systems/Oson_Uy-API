import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { MediaService } from '../media/media.service';

export const TEMPLATE_TYPES = [
  'CONTRACT',
  'GUARANTEE_LETTER',
  'PAYMENT_SCHEDULE',
] as const;
export type TemplateType = (typeof TEMPLATE_TYPES)[number];

export const TEMPLATE_LANGUAGES = ['uz', 'uz_cyrillic', 'ru'] as const;
export type TemplateLanguage = (typeof TEMPLATE_LANGUAGES)[number];

const ALLOWED_MIMES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword', // .doc
];

@Injectable()
export class ContractTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  private async assertMember(projectId: number, developerId: number) {
    const member = await this.prisma.projectMember.findFirst({
      where: { projectId, developerId },
    });
    if (!member) throw new ForbiddenException('Access denied');
  }

  async list(projectId: number, developerId: number) {
    await this.assertMember(projectId, developerId);
    return this.prisma.contractTemplate.findMany({
      where: { projectId },
      orderBy: [{ type: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async create(
    projectId: number,
    developerId: number,
    file: Express.Multer.File | undefined,
    body: {
      name?: string;
      type?: string;
      language?: string;
      isDefault?: string | boolean;
    },
  ) {
    await this.assertMember(projectId, developerId);

    if (!file) throw new BadRequestException('Файл шаблона обязателен');

    const isDocxName = /\.(docx?|DOCX?)$/.test(file.originalname);
    if (!ALLOWED_MIMES.includes(file.mimetype) && !isDocxName) {
      throw new BadRequestException('Допускаются только файлы Word (.docx)');
    }

    const type = (body.type ?? 'CONTRACT') as TemplateType;
    if (!TEMPLATE_TYPES.includes(type)) {
      throw new BadRequestException('Неизвестный тип шаблона');
    }

    const language = (body.language ?? 'uz') as TemplateLanguage;
    if (!TEMPLATE_LANGUAGES.includes(language)) {
      throw new BadRequestException('Неизвестный язык шаблона');
    }

    const isDefault = body.isDefault === true || body.isDefault === 'true';

    const url = await this.media.uploadDocument(file, 'contract-templates');

    // Only one default per (project, type, language)
    if (isDefault) {
      await this.prisma.contractTemplate.updateMany({
        where: { projectId, type, language },
        data: { isDefault: false },
      });
    }

    return this.prisma.contractTemplate.create({
      data: {
        projectId,
        name: body.name?.trim() || file.originalname,
        type,
        language,
        templateUrl: url,
        isDefault,
      },
    });
  }

  async remove(projectId: number, developerId: number, id: number) {
    await this.assertMember(projectId, developerId);
    const tmpl = await this.prisma.contractTemplate.findFirst({
      where: { id, projectId },
    });
    if (!tmpl) throw new NotFoundException('Шаблон не найден');
    await this.prisma.contractTemplate.delete({ where: { id } });
    return { ok: true };
  }
}
