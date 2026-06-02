import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerGuard } from '@nestjs/throttler';
import { PrismaService } from './prisma.service';
import { DevelopersModule } from './developers/developers.module';
import { ProjectsModule } from './projects/projects.module';
import { LeadsModule } from './leads/leads.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { MediaModule } from './media/media.module';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { FloorsModule } from './floors/floors.module';
import { PromoModule } from './promo/promo.module';
import { ApartmentsModule } from './apartments/apartments.module';
import { LayoutVariantsModule } from './layout-variants/layout-variants.module';
import { CustomersModule } from './customers/customers.module';
import { CustomerAuthModule } from './customer-auth/customer-auth.module';
import { ContractsModule } from './contracts/contracts.module';
import { DocumentGenerationModule } from './document-generation/document-generation.module';
import { DeveloperAuthGuard } from './common/guards/developer-auth.guard';
import { ProjectMemberGuard } from './common/guards/project-member.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: 60000,
          limit: 100,
        },
      ],
    }),
    DevelopersModule,
    ProjectsModule,
    LeadsModule,
    AnalyticsModule,
    MediaModule,
    AuthModule,
    BillingModule,
    FloorsModule,
    PromoModule,
    ApartmentsModule,
    LayoutVariantsModule,
    CustomerAuthModule,
    CustomersModule,
    ContractsModule,
    DocumentGenerationModule,
  ],
  providers: [
    PrismaService,
    DeveloperAuthGuard,
    ProjectMemberGuard,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
