import 'reflect-metadata';

import { isAbsolute, join } from 'node:path';

import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { enableMetrics } from '@hydromart/platform';

import { AppModule } from './app.module';
import { ProductConfigService } from './config/product-config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);

  const config = app.get(ProductConfigService);

  app.use(helmet());

  const uploadsRoot = isAbsolute(config.storageLocalDir)
    ? config.storageLocalDir
    : join(process.cwd(), config.storageLocalDir);
  app.useStaticAssets(uploadsRoot, { prefix: '/uploads' });

  app.enableCors({ origin: config.corsOrigins, credentials: true });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Hydromart — Product Service')
    .setDescription('Product catalog: public browse + admin management.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  enableMetrics(app, 'product-service');
  await app.listen(config.port, '0.0.0.0');
  logger.log(`product-service listening on port ${config.port}`, 'Bootstrap');
}

void bootstrap();
