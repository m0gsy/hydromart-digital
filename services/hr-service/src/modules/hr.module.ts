import { Module, OnApplicationBootstrap, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard, RolesGuard, DepotScopeGuard, SettingsCache } from '@hydromart/platform';

import { HrConfigService } from '../config/hr-config.service';
import { SETTINGS_REPOSITORY, SettingsRepository } from '../application/ports/settings.repository';
import { SettingsService } from '../application/services/settings.service';
import { EMPLOYEE_REPOSITORY } from '../application/ports/employee.repository';
import { EmployeeService } from '../application/services/employee.service';
import { FACE_EMBEDDING_REPOSITORY } from '../application/ports/face-embedding.repository';
import { ATTENDANCE_REPOSITORY } from '../application/ports/attendance.repository';
import { FACE_VERIFIER } from '../application/ports/face-verifier.port';
import { FaceService } from '../application/services/face.service';
import { AttendanceService } from '../application/services/attendance.service';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { SettingsPrismaRepository } from '../infrastructure/prisma/settings.prisma.repository';
import { EmployeePrismaRepository } from '../infrastructure/prisma/employee.prisma.repository';
import { FaceEmbeddingPrismaRepository } from '../infrastructure/prisma/face-embedding.prisma.repository';
import { AttendancePrismaRepository } from '../infrastructure/prisma/attendance.prisma.repository';
import { OnnxArcFaceVerifier } from '../infrastructure/face/onnx-arcface.verifier';
import { StubFaceVerifier } from '../infrastructure/face/stub-face.verifier';
import { SettingsController } from './settings.controller';
import { EmployeesController } from './employees.controller';
import { FaceController } from './face.controller';
import { AttendanceController } from './attendance.controller';

const providers: Provider[] = [
  PrismaService,
  { provide: SETTINGS_REPOSITORY, useClass: SettingsPrismaRepository },
  {
    provide: SettingsCache,
    useFactory: (repo: SettingsRepository) => new SettingsCache(repo),
    inject: [SETTINGS_REPOSITORY],
  },
  HrConfigService,
  SettingsService,
  { provide: EMPLOYEE_REPOSITORY, useClass: EmployeePrismaRepository },
  EmployeeService,
  { provide: FACE_EMBEDDING_REPOSITORY, useClass: FaceEmbeddingPrismaRepository },
  { provide: ATTENDANCE_REPOSITORY, useClass: AttendancePrismaRepository },
  // Face engine bound by FACE_VERIFIER_DRIVER: onnx (prod, needs vendored model) or
  // stub (dev/test, deterministic). 'http' remote driver is a future swap.
  {
    provide: FACE_VERIFIER,
    useFactory: (config: HrConfigService) =>
      config.faceVerifierDriver === 'stub'
        ? new StubFaceVerifier(config)
        : new OnnxArcFaceVerifier(config),
    inject: [HrConfigService],
  },
  FaceService,
  AttendanceService,
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
  { provide: APP_GUARD, useClass: DepotScopeGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [SettingsController, EmployeesController, FaceController, AttendanceController],
  providers,
  exports: [PrismaService, HrConfigService, SettingsCache],
})
export class HrModule implements OnApplicationBootstrap {
  constructor(private readonly settingsCache: SettingsCache) {}

  async onApplicationBootstrap(): Promise<void> {
    // fail-open: a boot-time DB hiccup must not crash the service; an empty snapshot just
    // means every getter falls through to its env default. The interval retries anyway.
    await this.settingsCache.refresh().catch(() => {});
    setInterval(() => {
      this.settingsCache.refresh().catch(() => {});
    }, this.settingsCache.ttl).unref();
  }
}
