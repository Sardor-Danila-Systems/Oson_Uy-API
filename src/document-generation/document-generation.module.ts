import { Module } from '@nestjs/common';
import { DocumentGenerationController } from './document-generation.controller';
import { DocumentGenerationService } from './document-generation.service';
import { ContractTemplatesController } from './contract-templates.controller';
import { ContractTemplatesService } from './contract-templates.service';
import { PrismaService } from '../prisma.service';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { DeveloperAuthGuard } from '../common/guards/developer-auth.guard';
import { ProjectMemberGuard } from '../common/guards/project-member.guard';

@Module({
  imports: [AuthModule, MediaModule],
  controllers: [DocumentGenerationController, ContractTemplatesController],
  providers: [
    DocumentGenerationService,
    ContractTemplatesService,
    PrismaService,
    DeveloperAuthGuard,
    ProjectMemberGuard,
  ],
  exports: [DocumentGenerationService],
})
export class DocumentGenerationModule {}
