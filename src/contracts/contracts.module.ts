import { Module } from '@nestjs/common';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [ContractsController],
  providers: [ContractsService, PrismaService],
  exports: [ContractsService],
})
export class ContractsModule {}
