import 'reflect-metadata';

import { isAbsolute, join } from 'node:path';

import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { AuthConfigService } from './config/auth-config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

  // Structured logging as the app logger.
  const logger = app.get(Logger);
  app.useLogger(logger);

  const config = app.get(AuthConfigService);

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
    .setDescription('Authentication & identity API (phone OTP, Google Sign-In, sessions).')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  await app.listen(config.port, '0.0.0.0');
  logger.log(`auth-service listening on port ${config.port}`, 'Bootstrap');
}

void bootstrap();
