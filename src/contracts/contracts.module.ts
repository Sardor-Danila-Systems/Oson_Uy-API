import { Module } from '@nestjs/common';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { PrismaService } from '../prisma.service';
import { AuthModule } from '../auth/auth.module';
import { DeveloperAuthGuard } from '../common/guards/developer-auth.guard';
import { ProjectMemberGuard } from '../common/guards/project-member.guard';
import { ProjectUltimatePlanGuard } from '../common/guards/project-ultimate-plan.guard';

@Module({
  imports: [AuthModule],
  controllers: [ContractsController],
  providers: [
    ContractsService,
    PrismaService,
    DeveloperAuthGuard,
    ProjectMemberGuard,
    ProjectUltimatePlanGuard,
  ],
  exports: [ContractsService],
})
export class ContractsModule {}
