import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { enableMetrics } from '@hydromart/platform';

import { AppModule } from './app.module';
import { GatewayConfigService } from './config/gateway-config.service';
import { configureGateway } from './gateway.setup';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);

  const config = app.get(GatewayConfigService);

  // Wire before listen() so the proxies/health/404 precede Nest's own router.
  configureGateway(app, config);
  app.enableShutdownHooks();

  enableMetrics(app, 'gateway-service');
  await app.listen(config.port, '0.0.0.0');
  logger.log(`gateway-service listening on port ${config.port}`, 'Bootstrap');
}

void bootstrap();
