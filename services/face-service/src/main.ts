import 'reflect-metadata';

import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { enableMetrics } from '@hydromart/platform';

import { AppModule } from './app.module';
import { FaceConfigService } from './config/face-config.service';
import { configureBodyLimits } from './http/body-limits';

async function bootstrap(): Promise<void> {
  // The embed route takes the JPEG as the raw body; Nest's own parsers would not.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: false });
  configureBodyLimits(app);
  const logger = app.get(Logger);
  app.useLogger(logger);

  app.use(helmet());
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();
  // No CORS and no docs: nothing but hr-service, inside the compose network, calls this.

  enableMetrics(app, 'face-service');
  const port = app.get(FaceConfigService).port;
  await app.listen(port, '0.0.0.0');
  logger.log(`face-service listening on port ${port}`, 'Bootstrap');
}

void bootstrap();
