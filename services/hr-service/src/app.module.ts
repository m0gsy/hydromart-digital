import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import { AllExceptionsFilter, GlobalValidationPipe } from '@hydromart/platform';

import { HrConfigService } from './config/hr-config.service';
import { envValidationSchema } from './config/env.validation';
import { HrModule } from './modules/hr.module';
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
            redact: ['req.headers.authorization', 'req.headers.cookie'],
            autoLogging: true,
          },
        };
      },
    }),
    ThrottlerModule.forRootAsync({
      inject: [HrConfigService],
      imports: [HrModule],
      useFactory: (config: HrConfigService) => [
        { ttl: config.rateLimit.ttlSeconds * 1000, limit: config.rateLimit.limit },
      ],
    }),
    HrModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_PIPE, useClass: GlobalValidationPipe },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
