import { Module } from '@nestjs/common';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { PrismaService } from '../prisma.service';
import { AuthModule } from '../auth/auth.module';
import { DeveloperAuthGuard } from '../common/guards/developer-auth.guard';
import { ProjectMemberGuard } from '../common/guards/project-member.guard';
import { PermissionGuard } from '../common/guards/permission.guard';

@Module({
  imports: [AuthModule],
  controllers: [MembersController],
  providers: [
    MembersService,
    PrismaService,
    DeveloperAuthGuard,
    ProjectMemberGuard,
    PermissionGuard,
  ],
})
export class MembersModule {}
