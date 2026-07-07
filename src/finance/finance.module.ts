import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { PrismaService } from '../prisma.service';
import { AuthModule } from '../auth/auth.module';
import { DeveloperAuthGuard } from '../common/guards/developer-auth.guard';
import { ProjectMemberGuard } from '../common/guards/project-member.guard';
import { ProjectUltimatePlanGuard } from '../common/guards/project-ultimate-plan.guard';

@Module({
  imports: [AuthModule],
  controllers: [FinanceController],
  providers: [
    FinanceService,
    PrismaService,
    DeveloperAuthGuard,
    ProjectMemberGuard,
    ProjectUltimatePlanGuard,
  ],
  exports: [FinanceService],
})
export class FinanceModule {}
