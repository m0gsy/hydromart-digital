import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';

import { GatewayConfigService } from './config/gateway-config.service';
import { envValidationSchema } from './config/env.validation';

// ponytail: no ThrottlerModule/swagger/auth guards — every route is an
// Express-level proxy, so Nest guards/filters would never fire on them.
// The edge rate-limiter (express-rate-limit, reads RATE_LIMIT_*) is wired at the
// Express layer in gateway.setup.ts, ahead of the proxies (SEC-3).
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
            // Mirrors @hydromart/platform's LOG_REDACT_PATHS, deliberately inlined for the
            // same reason INTERNAL_KEY_HEADER is inlined in gateway.setup.ts: importing the
            // platform barrel pulls the JWT guard and @nestjs/jwt, which this service does
            // not declare as a dependency and has no reason to load. Unlike the other 17,
            // the gateway never receives a legitimate internal key (services call each other
            // direct, and client-supplied keys are stripped before proxying) — it redacts so
            // an *injected* value never reaches the logs. Pinned by log-redact.spec.ts.
            redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-internal-key"]'],
            autoLogging: true,
          },
        };
      },
    }),
  ],
  providers: [GatewayConfigService],
})
export class AppModule {}
