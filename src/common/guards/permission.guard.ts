import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PrismaService } from '../../prisma.service';
import { can, PermissionKey } from '../permissions';

export const PERMISSION_KEY = 'required_permission';

/** Пометить маршрут требуемым правом: `@RequirePermission('finance')`. */
export const RequirePermission = (perm: PermissionKey) =>
  SetMetadata(PERMISSION_KEY, perm);

/**
 * Проверяет, что у участника проекта есть требуемое право (по роли + переопределениям).
 * Ставится ПОСЛЕ ProjectMemberGuard (нужен request.developerId и projectId).
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PermissionKey>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true; // маршрут без ограничений

    const req = context
      .switchToHttp()
      .getRequest<Request & { developerId?: number }>();
    if (!req.developerId) throw new UnauthorizedException('Missing identity');

    const projectId = Number(req.params?.projectId ?? req.params?.id);
    if (!projectId || Number.isNaN(projectId)) {
      throw new ForbiddenException('Invalid project ID');
    }

    const member = await this.prisma.projectMember.findFirst({
      where: { projectId, developerId: req.developerId },
      select: { role: true, permissions: true },
    });
    if (!member) throw new ForbiddenException('No access to this project');

    if (!can(member.role, member.permissions, required)) {
      throw new ForbiddenException(
        `PERMISSION_DENIED:${required}: недостаточно прав для этого действия`,
      );
    }
    return true;
  }
}
