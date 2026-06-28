import { Module } from '@nestjs/common';
import { Scenes3DController } from './scenes-3d.controller';
import { Scenes3DService } from './scenes-3d.service';
import { PrismaService } from '../prisma.service';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { DeveloperAuthGuard } from '../common/guards/developer-auth.guard';
import { ProjectMemberGuard } from '../common/guards/project-member.guard';
import { ProjectUltimatePlanGuard } from '../common/guards/project-ultimate-plan.guard';

@Module({
  imports: [AuthModule, MediaModule],
  controllers: [Scenes3DController],
  providers: [
    Scenes3DService,
    PrismaService,
    DeveloperAuthGuard,
    ProjectMemberGuard,
    ProjectUltimatePlanGuard,
  ],
  exports: [Scenes3DService],
})
export class Scenes3DModule {}
