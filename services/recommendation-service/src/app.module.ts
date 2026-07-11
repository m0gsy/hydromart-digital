import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import { AllExceptionsFilter, GlobalValidationPipe } from '@hydromart/platform';

import { envValidationSchema } from './config/env.validation';
import { RecommendationConfigService } from './config/recommendation-config.service';
import { PrismaService } from './infrastructure/prisma/prisma.service';
import { HealthController } from './modules/health.controller';

// ponytail: no feature module yet — domain/application/infrastructure business
// wiring (ports, services, controllers, JwtAuthGuard/RolesGuard) lands in later tasks.

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
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: Number(config.get('RATE_LIMIT_TTL_SECONDS', 60)) * 1000,
          limit: Number(config.get('RATE_LIMIT_MAX', 100)),
        },
      ],
    }),
  ],
  controllers: [HealthController],
  providers: [
    RecommendationConfigService,
    PrismaService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_PIPE, useClass: GlobalValidationPipe },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
