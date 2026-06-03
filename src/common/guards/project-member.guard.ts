import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class ProjectMemberGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<
      Request & { developerId?: number }
    >();
    if (!request.developerId) {
      throw new UnauthorizedException('Missing developer identity');
    }

    const projectIdRaw =
      request.params?.projectId ??
      request.params?.id ??
      request.body?.projectId ??
      request.query?.projectId;
    const projectId = Number(projectIdRaw);
    if (!projectId || Number.isNaN(projectId)) {
      throw new ForbiddenException('Invalid or missing project ID');
    }

    const member = await this.prisma.projectMember.findFirst({
      where: {
        projectId,
        developerId: request.developerId,
      },
    });
    if (!member) {
      throw new ForbiddenException('No access to this project workspace');
    }
    return true;
  }
}
