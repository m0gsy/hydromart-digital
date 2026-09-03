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
  httpDepotScopeResolver,
  protectDocs,
  startCapabilityRefresh,
} from '@hydromart/platform';

import { AppModule } from './app.module';
import { CustomerConfigService } from './config/customer-config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);

  const config = app.get(CustomerConfigService);

  app.use(helmet());

  // Serves agen photos written by the local-disk storage adapter (dev). In production the
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
    .setTitle('Hydromart — Customer Service')
    .setDescription('Customer profile, delivery addresses, and notification preferences.')
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
  // A supervisor's depots are a resolved SET, too large and too mutable for a JWT. Fails
  // CLOSED if depot-service is unreachable: there is no safe default for tenant isolation.
  configureDepotScope(
    httpDepotScopeResolver({
      depotServiceUrl: process.env.DEPOT_SERVICE_URL,
      internalKey: process.env.INTERNAL_SERVICE_KEY,
    }),
  );
  startCapabilityRefresh(
    httpCapabilityLoader({
      authServiceUrl: process.env.AUTH_SERVICE_URL,
      internalKey: process.env.INTERNAL_SERVICE_KEY,
    }),
    { logger },
  );

  enableMetrics(app, 'customer-service');
  await app.listen(config.port, '0.0.0.0');
  logger.log(`customer-service listening on port ${config.port}`, 'Bootstrap');
}

void bootstrap();
