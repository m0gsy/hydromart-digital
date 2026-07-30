import 'reflect-metadata';

import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { enableMetrics, httpCapabilityLoader, protectDocs, startCapabilityRefresh } from '@hydromart/platform';

import { AppModule } from './app.module';
import { ForecastConfigService } from './config/forecast-config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);

  const config = app.get(ForecastConfigService);

  app.use(helmet());
  app.enableCors({ origin: config.corsOrigins, credentials: true });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Hydromart — Forecast Service')
    .setDescription('Heuristic demand forecast: per-depot per-product near-term demand projection.')
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
  startCapabilityRefresh(
    httpCapabilityLoader({
      authServiceUrl: process.env.AUTH_SERVICE_URL,
      internalKey: process.env.INTERNAL_SERVICE_KEY,
    }),
    { logger },
  );

  enableMetrics(app, 'forecast-service');
  await app.listen(config.port, '0.0.0.0');
  logger.log(`forecast-service listening on port ${config.port}`, 'Bootstrap');
}

void bootstrap();
