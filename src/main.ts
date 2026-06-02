import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

// Serialize Prisma BigInt money fields (priceUzs, totalPriceUzs, amountUzs, …)
// as plain numbers in JSON. UZS amounts stay far within Number.MAX_SAFE_INTEGER.
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function () {
  return Number(this as unknown as bigint);
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalFilters(new AllExceptionsFilter());

  // Enable global validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.use(helmet());

  const corsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsOrigins.length ? corsOrigins : false,
    credentials: true,
  });

  // Configure Swagger
  const config = new DocumentBuilder()
    .setTitle('Real Estate Platform API')
    .setDescription(
      'API for managing real estate developers, projects, floors, and leads',
    )
    .setVersion('1.0')
    .addTag('developers', 'Developer management endpoints')
    .addTag('projects', 'Project management endpoints')
    .addTag('leads', 'Lead management endpoints')
    .addTag('analytics', 'MVP analytics endpoints')
    .addTag('media', 'Media upload endpoints')
    .addTag('auth', 'Developer authentication endpoints')
    .addTag('billing', 'Subscription billing endpoints')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  await app.listen(process.env.PORT ?? 3002);
  console.log('Application is running on: http://localhost:3002');
}
void bootstrap();
