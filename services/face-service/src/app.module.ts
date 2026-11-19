import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';

import { AllExceptionsFilter, LOG_REDACT_PATHS } from '@hydromart/platform';

import { EmbedService } from './application/embed.service';
import { envValidationSchema } from './config/env.validation';
import { FaceConfigService } from './config/face-config.service';
import { createOnnxFaceEngine, FACE_ENGINE } from './infrastructure/onnx-face.engine';
import { EmbedController } from './modules/embed.controller';
import { HealthController } from './modules/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env', '../../.env'],
      validationSchema: envValidationSchema,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isProduction = config.get<string>('NODE_ENV') === 'production';
        return {
          pinoHttp: {
            level: isProduction ? 'info' : 'debug',
            transport: isProduction ? undefined : { target: 'pino-pretty' },
            redact: [...LOG_REDACT_PATHS],
            autoLogging: true,
          },
        };
      },
    }),
  ],
  controllers: [HealthController, EmbedController],
  providers: [
    FaceConfigService,
    EmbedService,
    {
      // Boot fails, rather than serving, when a model is missing, is not the pinned file, or
      // cannot run: /health answers only once the engine has passed its self-check.
      provide: FACE_ENGINE,
      inject: [FaceConfigService],
      useFactory: async (config: FaceConfigService) => {
        const engine = await createOnnxFaceEngine(config.modelDir);
        await engine.selfCheck();
        return engine;
      },
    },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
