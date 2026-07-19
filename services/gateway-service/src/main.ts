import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

// Deep import (not the '@hydromart/platform' barrel): the barrel re-exports the
// JWT guard, transitively pulling @nestjs/jwt — a dep the gateway (pure proxy)
// deliberately avoids (see gateway.setup.ts). metrics.ts only needs prom-client.
import { enableMetrics } from '@hydromart/platform/dist/nest/metrics';

import { AppModule } from './app.module';
import { GatewayConfigService } from './config/gateway-config.service';
import { configureGateway } from './gateway.setup';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);

  const config = app.get(GatewayConfigService);

  // Before configureGateway: it registers a catch-all 404 for unknown routes, so
  // GET /metrics must be mounted first or the proxy swallows it (Prometheus 404).
  enableMetrics(app, 'gateway-service');

  // Wire before listen() so the proxies/health/404 precede Nest's own router.
  configureGateway(app, config);
  app.enableShutdownHooks();

  await app.listen(config.port, '0.0.0.0');
  logger.log(`gateway-service listening on port ${config.port}`, 'Bootstrap');
}

void bootstrap();
