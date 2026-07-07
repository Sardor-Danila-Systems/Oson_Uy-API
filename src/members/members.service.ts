import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProjectMemberRole } from '@prisma/client';
import { randomBytes, scryptSync } from 'crypto';
import { PrismaService } from '../prisma.service';
import {
  PERMISSION_KEYS,
  PERMISSION_LABELS,
  ROLE_DEFAULTS,
  ROLE_LABELS,
  resolvePermissions,
} from '../common/permissions';

const ASSIGNABLE: ProjectMemberRole[] = ['ADMIN', 'MANAGER', 'SALES'];

function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

@Injectable()
export class MembersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Каталог прав/ролей — единый источник для UI. */
  catalog() {
    return {
      permissions: PERMISSION_KEYS.map((key) => ({
        key,
        label: PERMISSION_LABELS[key],
      })),
      roles: (Object.keys(ROLE_LABELS) as ProjectMemberRole[]).map((role) => ({
        role,
        label: ROLE_LABELS[role],
        defaults: ROLE_DEFAULTS[role],
      })),
    };
  }

  /** Роль и итоговые права текущего пользователя в проекте (для навигации). */
  async me(projectId: number, developerId: number) {
    const member = await this.prisma.projectMember.findFirst({
      where: { projectId, developerId },
      select: { id: true, role: true, permissions: true },
    });
    if (!member) throw new ForbiddenException('No access to this project');
    return {
      memberId: member.id,
      role: member.role,
      roleLabel: ROLE_LABELS[member.role],
      permissions: resolvePermissions(member.role, member.permissions),
    };
  }

  /** Полный список команды проекта (требует право team). */
  async list(projectId: number, developerId: number) {
    const members = await this.prisma.projectMember.findMany({
      where: { projectId },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        role: true,
        permissions: true,
        createdAt: true,
        developer: {
          select: { id: true, name: true, email: true, phone: true },
        },
      },
    });
    return members.map((m) => ({
      id: m.id,
      role: m.role,
      roleLabel: ROLE_LABELS[m.role],
      permissions: resolvePermissions(m.role, m.permissions),
      hasOverrides: m.permissions != null,
      isYou: m.developer.id === developerId,
      createdAt: m.createdAt,
      developer: m.developer,
    }));
  }

  /** Пригласить сотрудника: создать/привязать аккаунт и роль. */
  async invite(
    projectId: number,
    dto: { name?: string; email: string; role: string; password?: string },
  ) {
    const email = dto.email?.trim().toLowerCase();
    if (!email || !email.includes('@'))
      throw new BadRequestException('Укажите корректный email');
    const role = ASSIGNABLE.includes(dto.role as ProjectMemberRole)
      ? (dto.role as ProjectMemberRole)
      : 'SALES';

    let developer = await this.prisma.developer.findUnique({
      where: { email },
    });
    let tempPassword: string | null = null;

    if (!developer) {
      tempPassword = dto.password?.trim() || randomBytes(4).toString('hex');
      developer = await this.prisma.developer.create({
        data: {
          name: dto.name?.trim() || email.split('@')[0],
          email,
          passwordHash: hashPassword(tempPassword),
        },
      });
    }

    const existing = await this.prisma.projectMember.findUnique({
      where: {
        projectId_developerId: { projectId, developerId: developer.id },
      },
    });
    if (existing)
      throw new BadRequestException(
        'Этот сотрудник уже добавлен в проект',
      );

    const member = await this.prisma.projectMember.create({
      data: { projectId, developerId: developer.id, role },
    });

    return {
      id: member.id,
      role: member.role,
      roleLabel: ROLE_LABELS[member.role],
      developer: {
        id: developer.id,
        name: developer.name,
        email: developer.email,
      },
      // отдаётся один раз — владелец передаёт сотруднику для первого входа
      tempPassword,
    };
  }

  private async assertTargetEditable(projectId: number, memberId: number) {
    const member = await this.prisma.projectMember.findFirst({
      where: { id: memberId, projectId },
    });
    if (!member) throw new NotFoundException('Сотрудник не найден');
    if (member.role === 'OWNER')
      throw new ForbiddenException('Нельзя изменять владельца аккаунта');
    return member;
  }

  async updateRole(projectId: number, memberId: number, role: string) {
    await this.assertTargetEditable(projectId, memberId);
    if (!ASSIGNABLE.includes(role as ProjectMemberRole))
      throw new BadRequestException('Недопустимая роль');
    // Смена роли сбрасывает индивидуальные переопределения → чистые дефолты роли
    await this.prisma.projectMember.update({
      where: { id: memberId },
      data: { role: role as ProjectMemberRole, permissions: Prisma.DbNull },
    });
    return { ok: true };
  }

  async updatePermissions(
    projectId: number,
    memberId: number,
    permissions: Record<string, boolean>,
  ) {
    await this.assertTargetEditable(projectId, memberId);
    const clean: Record<string, boolean> = {};
    for (const k of PERMISSION_KEYS) {
      if (typeof permissions?.[k] === 'boolean') clean[k] = permissions[k];
    }
    await this.prisma.projectMember.update({
      where: { id: memberId },
      data: { permissions: clean },
    });
    return { ok: true };
  }

  async remove(projectId: number, memberId: number, developerId: number) {
    const member = await this.assertTargetEditable(projectId, memberId);
    if (member.developerId === developerId)
      throw new ForbiddenException('Нельзя удалить самого себя');
    await this.prisma.projectMember.delete({ where: { id: memberId } });
    return { ok: true };
  }
}
