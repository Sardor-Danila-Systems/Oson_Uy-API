import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CreateApartmentDto } from './dto/create-apartment.dto';
import { UpdateApartmentDto } from './dto/update-apartment.dto';
import { FilterApartmentDto } from './dto/filter-apartment.dto';
import { BulkGenerateApartmentsDto } from './dto/bulk-generate-apartments.dto';
import {
  APARTMENT_UNIT_LAYOUT_INCLUDE,
  ApartmentUnitWithLayout,
} from './apartment-unit.include';

@Injectable()
export class ApartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Публичный ответ квартиры: плоские URL плана/3D с учётом layout variant. */
  serializeUnit(u: ApartmentUnitWithLayout) {
    const lv = u.layoutVariant;
    const resolvedLayoutImage =
      u.layoutImageUrl ?? lv?.projectFloorLayout.imageUrl ?? null;
    const resolvedModel3d = u.model3dUrl ?? lv?.model3dUrl ?? null;
    const { layoutVariant, ...rest } = u;
    return {
      ...rest,
      layoutImageUrl: resolvedLayoutImage,
      model3dUrl: resolvedModel3d,
      layoutVariant: lv
        ? {
            id: lv.id,
            code: lv.code,
            projectFloorLayoutId: lv.projectFloorLayoutId,
            model3dUrl: lv.model3dUrl,
            projectFloorLayout: lv.projectFloorLayout,
          }
        : null,
    };
  }

  private static readonly MAX_BULK_UNITS = 2500;

  /**
   * Resolve total price and price-per-m² from whatever the user provided.
   * If price-per-m² is given, the total price is computed (area × per-m²).
   * Otherwise the per-m² is derived from the total price.
   */
  private resolvePrice(
    areaSqm: number,
    priceUzs?: number | null,
    pricePerM2Uzs?: number | null,
  ): { priceUzs: number | null; pricePerM2Uzs: number | null } {
    if (pricePerM2Uzs != null && pricePerM2Uzs > 0 && areaSqm > 0) {
      return {
        pricePerM2Uzs,
        priceUzs: Math.round(pricePerM2Uzs * areaSqm),
      };
    }
    if (priceUzs != null && priceUzs > 0 && areaSqm > 0) {
      return { priceUzs, pricePerM2Uzs: Math.round(priceUzs / areaSqm) };
    }
    return {
      priceUzs: priceUzs ?? null,
      pricePerM2Uzs: pricePerM2Uzs ?? null,
    };
  }

  async assertProjectMember(projectId: number, developerId: number) {
    const member = await this.prisma.projectMember.findFirst({
      where: { projectId, developerId },
    });
    if (!member) {
      throw new ForbiddenException('No access to this project workspace');
    }
  }

  private async assertLayoutVariantInProject(
    projectId: number,
    layoutVariantId: number,
  ) {
    const v = await this.prisma.layoutVariant.findFirst({
      where: { id: layoutVariantId, projectId },
      select: { id: true },
    });
    if (!v) {
      throw new BadRequestException('layoutVariantId is not in this project');
    }
  }

  async listPublic(projectId: number, query: FilterApartmentDto) {
    await this.ensureProjectExists(projectId);
    return this.list(projectId, query);
  }

  async list(projectId: number, query: FilterApartmentDto) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 200, 500);
    const skip = (page - 1) * limit;

    const where: Prisma.ApartmentUnitWhereInput = { projectId };
    if (query.status) where.status = query.status;
    if (query.floor != null) where.floor = query.floor;

    const [rows, total] = await Promise.all([
      this.prisma.apartmentUnit.findMany({
        where,
        orderBy: [
          { sectionKey: 'asc' },
          { floor: 'desc' },
          { sortOrder: 'asc' },
          { number: 'asc' },
        ],
        skip,
        take: limit,
        include: APARTMENT_UNIT_LAYOUT_INCLUDE,
      }),
      this.prisma.apartmentUnit.count({ where }),
    ]);

    return {
      items: rows.map((r) => this.serializeUnit(r)),
      total,
      page,
      limit,
    };
  }

  async create(
    projectId: number,
    dto: CreateApartmentDto,
    developerId: number,
  ) {
    await this.assertProjectMember(projectId, developerId);
    if (dto.layoutVariantId != null) {
      await this.assertLayoutVariantInProject(projectId, dto.layoutVariantId);
    }
    try {
      const sectionKey = (dto.sectionKey ?? '').trim();
      const price = this.resolvePrice(
        dto.areaSqm,
        dto.priceUzs,
        dto.pricePerM2Uzs,
      );
      return await this.prisma.apartmentUnit.create({
        data: {
          projectId,
          sectionKey,
          number: dto.number.trim(),
          floor: dto.floor,
          rooms: dto.rooms,
          areaSqm: dto.areaSqm,
          priceUzs: price.priceUzs,
          pricePerM2Uzs: price.pricePerM2Uzs,
          status: dto.status ?? undefined,
          layoutVariantId: dto.layoutVariantId ?? null,
          layoutImageUrl: dto.layoutImageUrl?.trim() || null,
          model3dUrl: dto.model3dUrl?.trim() || null,
          crmMetadata:
            dto.crmMetadata === undefined
              ? undefined
              : (dto.crmMetadata as Prisma.InputJsonValue),
          sortOrder: dto.sortOrder ?? 0,
        },
        include: APARTMENT_UNIT_LAYOUT_INCLUDE,
      }).then((r) => this.serializeUnit(r));
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new BadRequestException(
          'Квартира с таким номером уже есть в этом проекте (учитывается блок)',
        );
      }
      throw e;
    }
  }

  async bulkGenerate(
    projectId: number,
    dto: BulkGenerateApartmentsDto,
    developerId: number,
  ) {
    await this.assertProjectMember(projectId, developerId);

    const sections = dto.sections.map((s) => ({
      ...s,
      sectionKey: s.sectionKey.trim(),
      sectionLabel: s.sectionLabel?.trim(),
    }));

    if (sections.length > 1) {
      for (const s of sections) {
        if (!s.sectionKey) {
          throw new BadRequestException(
            'При нескольких блоках у каждого укажите код блока (например A, B)',
          );
        }
      }
    }

    const keys = sections.map((s) => s.sectionKey);
    if (new Set(keys).size !== keys.length) {
      throw new BadRequestException('Коды блоков в запросе должны быть уникальны');
    }

    for (const s of sections) {
      if (s.layoutVariantId != null) {
        await this.assertLayoutVariantInProject(projectId, s.layoutVariantId);
      }
    }

    const rows: Prisma.ApartmentUnitCreateManyInput[] = [];
    const seenNumbers = new Set<string>();

    for (const sec of sections) {
      const sk = sec.sectionKey;
      const floorLo = Math.min(sec.floorFrom, sec.floorTo);
      const floorHi = Math.max(sec.floorFrom, sec.floorTo);
      if (floorLo < -5 || floorHi > 100) {
        throw new BadRequestException('Допустимый диапазон этажей: от -5 до 100');
      }

      const price = this.resolvePrice(
        sec.areaSqm,
        sec.priceUzs,
        sec.pricePerM2Uzs,
      );

      // Apartments are numbered as plain sequential numbers within the block
      // (1, 2, 3 …) running through the floors — like UySot.
      let counter = 0;
      for (let f = floorLo; f <= floorHi; f++) {
        for (let u = 1; u <= sec.unitsPerFloor; u++) {
          counter += 1;
          const number = String(counter);
          const dedupe = `${sk}\n${number}`;
          if (seenNumbers.has(dedupe)) {
            throw new BadRequestException(`Дубликат номера внутри запроса: ${number}`);
          }
          seenNumbers.add(dedupe);

          const meta =
            sec.sectionLabel != null && sec.sectionLabel !== ''
              ? ({ sectionLabel: sec.sectionLabel } satisfies Record<string, string>)
              : undefined;

          rows.push({
            projectId,
            sectionKey: sk,
            number,
            floor: f,
            rooms: sec.rooms,
            areaSqm: sec.areaSqm,
            priceUzs: price.priceUzs,
            pricePerM2Uzs: price.pricePerM2Uzs,
            layoutVariantId: sec.layoutVariantId ?? null,
            sortOrder: f * 100 + u,
            ...(meta
              ? { crmMetadata: meta as Prisma.InputJsonValue }
              : {}),
          });
        }
      }
    }

    if (rows.length === 0) {
      throw new BadRequestException('Не сгенерировано ни одной квартиры');
    }
    if (rows.length > ApartmentsService.MAX_BULK_UNITS) {
      throw new BadRequestException(
        `Слишком много квартир за раз (макс. ${ApartmentsService.MAX_BULK_UNITS})`,
      );
    }

    try {
      const result = await this.prisma.apartmentUnit.createMany({
        data: rows,
      });
      return { created: result.count };
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new BadRequestException(
          'Часть номеров уже занята в проекте. Удалите дубликаты или измените диапазоны этажей/блоков.',
        );
      }
      throw e;
    }
  }

  async update(
    projectId: number,
    apartmentId: number,
    dto: UpdateApartmentDto,
    developerId: number,
  ) {
    await this.assertProjectMember(projectId, developerId);
    const apt = await this.prisma.apartmentUnit.findFirst({
      where: { id: apartmentId, projectId },
    });
    if (!apt) throw new NotFoundException('Apartment not found');

    if (dto.layoutVariantId !== undefined && dto.layoutVariantId != null) {
      await this.assertLayoutVariantInProject(projectId, dto.layoutVariantId);
    }

    // Resolve price/price-per-m² so total price stays consistent
    const effArea = dto.areaSqm ?? apt.areaSqm;
    let setPrice: number | null | undefined;
    let setPerM2: number | null | undefined;
    if (dto.pricePerM2Uzs !== undefined) {
      setPerM2 = dto.pricePerM2Uzs;
      if (dto.pricePerM2Uzs != null && dto.pricePerM2Uzs > 0 && effArea > 0) {
        setPrice = Math.round(dto.pricePerM2Uzs * effArea);
      }
    }
    if (dto.priceUzs !== undefined) {
      setPrice = dto.priceUzs;
      if (dto.priceUzs != null && dto.priceUzs > 0 && effArea > 0) {
        setPerM2 = Math.round(dto.priceUzs / effArea);
      }
    }

    try {
      const updated = await this.prisma.apartmentUnit.update({
        where: { id: apartmentId },
        data: {
          ...(dto.sectionKey !== undefined
            ? { sectionKey: dto.sectionKey.trim() }
            : {}),
          ...(dto.number != null ? { number: dto.number.trim() } : {}),
          ...(dto.floor != null ? { floor: dto.floor } : {}),
          ...(dto.rooms != null ? { rooms: dto.rooms } : {}),
          ...(dto.areaSqm != null ? { areaSqm: dto.areaSqm } : {}),
          ...(setPrice !== undefined ? { priceUzs: setPrice } : {}),
          ...(setPerM2 !== undefined ? { pricePerM2Uzs: setPerM2 } : {}),
          ...(dto.status != null ? { status: dto.status } : {}),
          ...(dto.layoutVariantId !== undefined
            ? { layoutVariantId: dto.layoutVariantId }
            : {}),
          ...(dto.layoutImageUrl !== undefined
            ? { layoutImageUrl: dto.layoutImageUrl }
            : {}),
          ...(dto.model3dUrl !== undefined ? { model3dUrl: dto.model3dUrl } : {}),
          ...(dto.crmMetadata !== undefined
            ? {
                crmMetadata:
                  dto.crmMetadata === null
                    ? null
                    : (dto.crmMetadata as Prisma.InputJsonValue),
              }
            : {}),
          ...(dto.sortOrder != null ? { sortOrder: dto.sortOrder } : {}),
        },
        include: APARTMENT_UNIT_LAYOUT_INCLUDE,
      });
      return this.serializeUnit(updated);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new BadRequestException(
          'Квартира с таким номером уже есть в этом проекте (учитывается блок)',
        );
      }
      throw e;
    }
  }

  async remove(projectId: number, apartmentId: number, developerId: number) {
    await this.assertProjectMember(projectId, developerId);
    const apt = await this.prisma.apartmentUnit.findFirst({
      where: { id: apartmentId, projectId },
    });
    if (!apt) throw new NotFoundException('Apartment not found');
    await this.prisma.apartmentUnit.delete({ where: { id: apartmentId } });
    return { ok: true };
  }

  async findOneForDeveloper(
    projectId: number,
    apartmentId: number,
    developerId: number,
  ) {
    await this.assertProjectMember(projectId, developerId);
    const apt = await this.prisma.apartmentUnit.findFirst({
      where: { id: apartmentId, projectId },
      include: {
        ...APARTMENT_UNIT_LAYOUT_INCLUDE,
        customers: {
          select: {
            id: true,
            name: true,
            phone: true,
            accessCode: true,
            createdAt: true,
            payments: {
              orderBy: { paidAt: 'desc' },
              take: 30,
              select: {
                id: true,
                amountUzs: true,
                paidAt: true,
                comment: true,
                type: true,
              },
            },
          },
        },
        leads: {
          take: 20,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            name: true,
            phone: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });
    if (!apt) throw new NotFoundException('Apartment not found');

    const { customers, leads, ...core } = apt;
    return {
      ...this.serializeUnit(core as ApartmentUnitWithLayout),
      customers,
      leads,
    };
  }

  private async ensureProjectExists(projectId: number) {
    const p = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!p) throw new NotFoundException('Project not found');
  }
}
