import 'reflect-metadata';

import { isAbsolute, join } from 'node:path';

import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import {
  configureDepotScope,
  enableMetrics,
  httpCapabilityLoader,
  protectDocs,
  startCapabilityRefresh,
} from '@hydromart/platform';

import { AppModule } from './app.module';
import { HierarchyService } from './application/services/hierarchy.service';
import { DepotConfigService } from './config/depot-config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);

  const config = app.get(DepotConfigService);

  app.use(helmet());

  // Serves QRIS images written by the local-disk storage adapter (dev). In production the
  // S3 adapter returns the object-storage URL and nothing is served from here.
  const uploadsRoot = isAbsolute(config.storageLocalDir)
    ? config.storageLocalDir
    : join(process.cwd(), config.storageLocalDir);
  app.useStaticAssets(uploadsRoot, { prefix: '/uploads' });

  app.enableCors({ origin: config.corsOrigins, credentials: true });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Hydromart — Depot Service')
    .setDescription('Depot management (hours, delivery zone, holidays) + per-depot inventory.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  // M12-11: production docs are Basic-auth'd, or not mounted at all when
  // DOCS_USER/DOCS_PASSWORD are unset. Open in development, unchanged.
  if (protectDocs(app)) {
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig));
  }
  // Keep the RBAC matrix current without a deploy: poll auth-service for the super
  // admin's overrides. Failure leaves the compiled defaults in place, never a lockout.
  // depot-service OWNS the hierarchy, so it resolves in-process instead of calling its own
  // HTTP endpoint.
  const hierarchy = app.get(HierarchyService);
  configureDepotScope((staffId, role) => hierarchy.scopedDepotIds(staffId, role));
  startCapabilityRefresh(
    httpCapabilityLoader({
      authServiceUrl: process.env.AUTH_SERVICE_URL,
      internalKey: process.env.INTERNAL_SERVICE_KEY,
    }),
    { logger },
  );

  enableMetrics(app, 'depot-service');
  await app.listen(config.port, '0.0.0.0');
  logger.log(`depot-service listening on port ${config.port}`, 'Bootstrap');
}

void bootstrap();
