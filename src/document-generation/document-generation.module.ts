import { Module } from '@nestjs/common';
import { DocumentGenerationController } from './document-generation.controller';
import { DocumentGenerationService } from './document-generation.service';
import { PrismaService } from '../prisma.service';
import { AuthModule } from '../auth/auth.module';
import { DeveloperAuthGuard } from '../common/guards/developer-auth.guard';

@Module({
  imports: [AuthModule],
  controllers: [DocumentGenerationController],
  providers: [DocumentGenerationService, PrismaService, DeveloperAuthGuard],
  exports: [DocumentGenerationService],
})
export class DocumentGenerationModule {}
