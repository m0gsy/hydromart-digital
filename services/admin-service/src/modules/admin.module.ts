import { Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard, RolesGuard } from '@hydromart/platform';

import { AdminConfigService } from '../config/admin-config.service';
import { ADMIN_TOKENS } from '../application/tokens';
import { FeatureFlagService } from '../application/services/feature-flag.service';
import { SystemSettingsService } from '../application/services/system-settings.service';
import { SystemHealthService } from '../application/services/system-health.service';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { FeatureFlagPrismaRepository } from '../infrastructure/prisma/feature-flag.prisma.repository';
import { SystemSettingsPrismaRepository } from '../infrastructure/prisma/system-settings.prisma.repository';
import { HealthProbeHttpAdapter } from '../infrastructure/http/health-probe.http.adapter';
import { FeatureFlagsController } from './feature-flags.controller';
import { SystemSettingsController } from './system-settings.controller';
import { SystemHealthController } from './system-health.controller';

const providers: Provider[] = [
  PrismaService,
  AdminConfigService,
  FeatureFlagService,
  SystemSettingsService,
  SystemHealthService,
  { provide: ADMIN_TOKENS.FeatureFlagRepository, useClass: FeatureFlagPrismaRepository },
  { provide: ADMIN_TOKENS.SystemSettingsRepository, useClass: SystemSettingsPrismaRepository },
  { provide: ADMIN_TOKENS.HealthProbe, useClass: HealthProbeHttpAdapter },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [FeatureFlagsController, SystemSettingsController, SystemHealthController],
  providers,
  exports: [PrismaService, AdminConfigService],
})
export class AdminModule {}
