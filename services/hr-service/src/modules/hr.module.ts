import { Module, OnApplicationBootstrap, Provider } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
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
import { PAYROLL_REPOSITORY } from '../application/ports/payroll.repository';
import { BONUS_REPOSITORY, DEDUCTION_REPOSITORY } from '../application/ports/adjustment.repository';
import { PayrollService } from '../application/services/payroll.service';
import { AdjustmentService } from '../application/services/adjustment.service';
import { PayrollPrismaRepository } from '../infrastructure/prisma/payroll.prisma.repository';
import { BonusPrismaRepository, DeductionPrismaRepository } from '../infrastructure/prisma/adjustment.prisma.repository';
import { PERFORMANCE_REPOSITORY } from '../application/ports/performance.repository';
import { PerformanceService } from '../application/services/performance.service';
import { PerformancePrismaRepository } from '../infrastructure/prisma/performance.prisma.repository';
import { AUDIT_REPOSITORY } from '../application/ports/audit.repository';
import { AuditService } from '../application/services/audit.service';
import { AuditPrismaRepository } from '../infrastructure/prisma/audit.prisma.repository';
import { AuditInterceptor } from '../infrastructure/http/audit.interceptor';
import { ANALYTICS_REPOSITORY } from '../application/ports/analytics.repository';
import { AnalyticsService } from '../application/services/analytics.service';
import { AnalyticsPrismaRepository } from '../infrastructure/prisma/analytics.prisma.repository';
import { STORAGE_PORT } from '../application/ports/storage.port';
import { S3StorageAdapter } from '../infrastructure/storage/s3-storage.adapter';
import { DisabledStorageAdapter } from '../infrastructure/storage/disabled-storage.adapter';
import { HOLIDAY_REPOSITORY } from '../application/ports/holiday.repository';
import { SHIFT_REPOSITORY } from '../application/ports/shift.repository';
import { HolidayService } from '../application/services/holiday.service';
import { ShiftService } from '../application/services/shift.service';
import { HolidayPrismaRepository } from '../infrastructure/prisma/holiday.prisma.repository';
import { ShiftPrismaRepository } from '../infrastructure/prisma/shift.prisma.repository';
import { HolidayController, ShiftController } from './calendar.controller';
import { SettingsController } from './settings.controller';
import { EmployeesController } from './employees.controller';
import { FaceController, SelfFaceController } from './face.controller';
import { AttendanceController } from './attendance.controller';
import { PayrollController } from './payroll.controller';
import { BonusController, DeductionController } from './adjustment.controller';
import { PerformanceController } from './performance.controller';
import { AuditController } from './audit.controller';
import { ReportsController } from './reports.controller';

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
  // Photo storage: S3 in prod (HR_STORAGE_DRIVER=s3), no-op otherwise. Injected @Optional
  // into Face/Attendance services — an absent binding just skips persisting photoUrls.
  {
    provide: STORAGE_PORT,
    useFactory: (config: HrConfigService) =>
      config.storageDriver === 's3' ? new S3StorageAdapter(config) : new DisabledStorageAdapter(),
    inject: [HrConfigService],
  },
  FaceService,
  AttendanceService,
  { provide: PAYROLL_REPOSITORY, useClass: PayrollPrismaRepository },
  { provide: BONUS_REPOSITORY, useClass: BonusPrismaRepository },
  { provide: DEDUCTION_REPOSITORY, useClass: DeductionPrismaRepository },
  PayrollService,
  AdjustmentService,
  { provide: PERFORMANCE_REPOSITORY, useClass: PerformancePrismaRepository },
  PerformanceService,
  { provide: AUDIT_REPOSITORY, useClass: AuditPrismaRepository },
  AuditService,
  { provide: ANALYTICS_REPOSITORY, useClass: AnalyticsPrismaRepository },
  AnalyticsService,
  { provide: HOLIDAY_REPOSITORY, useClass: HolidayPrismaRepository },
  { provide: SHIFT_REPOSITORY, useClass: ShiftPrismaRepository },
  HolidayService,
  ShiftService,
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
  { provide: APP_GUARD, useClass: DepotScopeGuard },
  // Audit trail: one row per successful mutating HR request.
  { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [
    SettingsController,
    EmployeesController,
    FaceController,
    SelfFaceController,
    AttendanceController,
    PayrollController,
    BonusController,
    DeductionController,
    PerformanceController,
    AuditController,
    ReportsController,
    HolidayController,
    ShiftController,
  ],
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
