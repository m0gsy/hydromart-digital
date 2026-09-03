import 'reflect-metadata';

import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
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
import { OrderConfigService } from './config/order-config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);

  const config = app.get(OrderConfigService);

  app.use(helmet());
  app.enableCors({ origin: config.corsOrigins, credentials: true });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Hydromart — Order Service')
    .setDescription('Cart, checkout, and the order lifecycle (BR-005/006/012).')
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

  // ORDER_ALERT_PHONE has no format validation, and it cannot get one: a pattern that
  // rejects the value already in a running .env would turn a cosmetic problem into a
  // service that will not boot. So it is a WARNING, said once, at the only moment
  // anybody is looking at this log. The adapter normalises separators, so this only
  // fires on a value no amount of stripping can rescue — and every staff alert
  // (meter variance, and now the SOP sales report) goes to that number.
  const alertPhone = config.alertPhone;
  if (alertPhone && !/^\+?[0-9]{8,15}$/.test(alertPhone.replace(/[^\d+]/g, ''))) {
    logger.warn(
      `ORDER_ALERT_PHONE is not a usable phone number — staff alerts will not be sent`,
      'Bootstrap',
    );
  }

  enableMetrics(app, 'order-service');
  await app.listen(config.port, '0.0.0.0');
  logger.log(`order-service listening on port ${config.port}`, 'Bootstrap');
}

void bootstrap();
