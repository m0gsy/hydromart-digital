import 'reflect-metadata';

import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { enableMetrics } from '@hydromart/platform';

import { AppModule } from './app.module';
import { ReferralConfigService } from './config/referral-config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);

  const config = app.get(ReferralConfigService);

  app.use(helmet());
  app.enableCors({ origin: config.corsOrigins, credentials: true });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Hydromart — Referral Service')
    .setDescription('Referral program: shareable codes, redemption, and qualification rewards.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  enableMetrics(app, 'referral-service');
  await app.listen(config.port, '0.0.0.0');
  logger.log(`referral-service listening on port ${config.port}`, 'Bootstrap');
}

void bootstrap();
