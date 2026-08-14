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
  httpDepotScopeResolver,
  protectDocs,
  startCapabilityRefresh,
} from '@hydromart/platform';

import { AppModule } from './app.module';
import { AccessMatrixService } from './application/services/access-matrix.service';
import { AuthConfigService } from './config/auth-config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

  // Structured logging as the app logger.
  const logger = app.get(Logger);
  app.useLogger(logger);

  const config = app.get(AuthConfigService);

  // auth-service owns the override table, so it reads straight from the database
  // instead of calling its own HTTP endpoint. Same refresher, same fail-open rule.
  const matrix = app.get(AccessMatrixService);
  startCapabilityRefresh(() => matrix.patch(), { logger });

  // The staff directory and the driver roster are read by supervisors and depot managers,
  // whose depots live in depot-service's hierarchy. Without this the DepotScopeGuard
  // registered in auth.module cannot resolve them, and a multi-depot caller keeps only the
  // depot their own token carries — which for a manager is none.
  configureDepotScope(
    httpDepotScopeResolver({
      depotServiceUrl: process.env.DEPOT_SERVICE_URL,
      internalKey: process.env.INTERNAL_SERVICE_KEY,
    }),
  );

  app.use(helmet());

  const uploadsRoot = isAbsolute(config.storageLocalDir)
    ? config.storageLocalDir
    : join(process.cwd(), config.storageLocalDir);
  app.useStaticAssets(uploadsRoot, { prefix: '/uploads' });
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Hydromart — Auth Service')
    // M1-04: login is phone OTP only. Google Sign-In was decided AGAINST — there is no
    // /auth/google endpoint and no button in the app, so the docs must not imply one.
    .setDescription('Authentication & identity API (phone OTP, sessions).')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  // M12-11: production docs are Basic-auth'd, or not mounted at all when
  // DOCS_USER/DOCS_PASSWORD are unset. Open in development, unchanged.
  if (protectDocs(app)) {
    SwaggerModule.setup('docs', app, document);
  }

  enableMetrics(app, 'auth-service');
  await app.listen(config.port, '0.0.0.0');
  logger.log(`auth-service listening on port ${config.port}`, 'Bootstrap');
}

void bootstrap();
