import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../prisma.service';
import { SubscriptionPlan, SubscriptionStatus } from '@prisma/client';

/**
 * Allows developer project workspace routes only when the project has an
 * active Ultra (ULTIMATE) subscription (TRIAL or ACTIVE).
 */
@Injectable()
export class ProjectUltimatePlanGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<
      Request & { developerId?: number }
    >();
    const projectId = Number(request.params?.projectId);
    if (!projectId || Number.isNaN(projectId)) {
      throw new ForbiddenException('Invalid or missing project ID');
    }

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        subscription: { select: { plan: true, status: true } },
      },
    });

    const sub = project?.subscription;
    if (!sub || sub.plan !== SubscriptionPlan.ULTIMATE) {
      throw new ForbiddenException(
        'ULTIMATE_PLAN_REQUIRED: Chessboard and customer CRM are available only on the Ultra (ULTIMATE) plan.',
      );
    }
    if (
      sub.status !== SubscriptionStatus.ACTIVE &&
      sub.status !== SubscriptionStatus.TRIAL
    ) {
      throw new ForbiddenException(
        'SUBSCRIPTION_INACTIVE: Activate or renew Ultra (ULTIMATE) to use chessboard and customers.',
      );
    }
    return true;
  }
}
