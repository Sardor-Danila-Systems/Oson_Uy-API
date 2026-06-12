import { Module } from '@nestjs/common';
import { DevelopersService } from './developers.service';
import { DevelopersController } from './developers.controller';
import { PrismaService } from '../prisma.service';
import { AuthModule } from '../auth/auth.module';
import { DeveloperAuthGuard } from '../common/guards/developer-auth.guard';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [AuthModule, ConfigModule, CommonModule],
  controllers: [DevelopersController],
  providers: [DevelopersService, PrismaService, DeveloperAuthGuard],
})
export class DevelopersModule {}
