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
            redact: ['req.headers.authorization', 'req.headers.cookie'],
            autoLogging: true,
          },
        };
      },
    }),
  ],
  providers: [GatewayConfigService],
})
export class AppModule {}
