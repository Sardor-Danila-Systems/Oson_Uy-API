import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma.service';
import { PromoController } from './promo.controller';
import { PromoService } from './promo.service';
import { DeveloperAuthGuard } from '../common/guards/developer-auth.guard';

@Module({
  imports: [AuthModule],
  controllers: [PromoController],
  providers: [PromoService, PrismaService, DeveloperAuthGuard],
})
export class PromoModule {}

