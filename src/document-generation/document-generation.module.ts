import { Module } from '@nestjs/common';
import { DocumentGenerationController } from './document-generation.controller';
import { DocumentGenerationService } from './document-generation.service';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [DocumentGenerationController],
  providers: [DocumentGenerationService, PrismaService],
  exports: [DocumentGenerationService],
})
export class DocumentGenerationModule {}
