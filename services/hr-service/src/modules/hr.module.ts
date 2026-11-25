import { Module, OnApplicationBootstrap, Provider } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard, RolesGuard, DepotScopeGuard, SettingsCache } from '@hydromart/platform';

import { HrConfigService } from '../config/hr-config.service';
import { SETTINGS_REPOSITORY, SettingsRepository } from '../application/ports/settings.repository';
import { SettingsService } from '../application/services/settings.service';
import { EMPLOYEE_REPOSITORY } from '../application/ports/employee.repository';
import { IDENTITY_PORT } from '../application/ports/identity.port';
import { SUPERVISION_PORT } from '../application/ports/supervision.port';
import { SupervisionHttpAdapter } from '../infrastructure/http/supervision.http.adapter';
import { EmployeeService } from '../application/services/employee.service';
import { FACE_EMBEDDING_REPOSITORY } from '../application/ports/face-embedding.repository';
import {
  FACE_MAINTENANCE_REPOSITORY,
  FaceMaintenanceRepository,
} from '../application/ports/face-maintenance.repository';
import { FaceMaintenanceService } from '../application/services/face-maintenance.service';
import { FaceMaintenancePrismaRepository } from '../infrastructure/prisma/face-maintenance.prisma.repository';
import { FaceMaintenanceController } from './face-maintenance.controller';
import { ATTENDANCE_REPOSITORY } from '../application/ports/attendance.repository';
import { FACE_VERIFIER } from '../application/ports/face-verifier.port';
import { FaceService } from '../application/services/face.service';
import { AttendanceService } from '../application/services/attendance.service';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { SettingsPrismaRepository } from '../infrastructure/prisma/settings.prisma.repository';
import { EmployeePrismaRepository } from '../infrastructure/prisma/employee.prisma.repository';
import { FaceEmbeddingPrismaRepository } from '../infrastructure/prisma/face-embedding.prisma.repository';
import { AttendancePrismaRepository } from '../infrastructure/prisma/attendance.prisma.repository';
import { NeoFaceProvider } from '../infrastructure/face/neo-face.provider';
import { OnnxArcFaceVerifier } from '../infrastructure/face/onnx-arcface.verifier';
import { StubFaceVerifier } from '../infrastructure/face/stub-face.verifier';
import { FaceServiceClient } from '../infrastructure/face/face-service.client';
import { ShadowFaceVerifier } from '../infrastructure/face/shadow-face.verifier';
import { FaceTemplateBackfill } from '../application/services/face-template-backfill.service';
import { LOCAL_FACE_ENGINE, type LocalFaceEngine } from '../application/ports/local-face-engine.port';
import { PAYROLL_REPOSITORY } from '../application/ports/payroll.repository';
import { BONUS_REPOSITORY, DEDUCTION_REPOSITORY } from '../application/ports/adjustment.repository';
import { PayrollService } from '../application/services/payroll.service';
import { AdjustmentService } from '../application/services/adjustment.service';
import { PayrollPrismaRepository } from '../infrastructure/prisma/payroll.prisma.repository';
import {
  BonusPrismaRepository,
  DeductionPrismaRepository,
} from '../infrastructure/prisma/adjustment.prisma.repository';
import { BONUS_RULE_REPOSITORY } from '../application/ports/bonus-rule.repository';
import { LOAN_REPOSITORY } from '../application/ports/loan.repository';
import { DEPOT_ASSIGNMENT_REPOSITORY } from '../application/ports/depot-assignment.repository';
import { DEPOT_DIRECTORY_PORT } from '../application/ports/depot-directory.port';
import { OWNED_DEPOTS_PORT } from '../application/ports/owned-depots.port';
import { OwnerAttendanceService } from '../application/services/owner-attendance.service';
import { OwnedDepotsHttpAdapter } from '../infrastructure/http/owned-depots.http.adapter';
import { OwnerAttendanceController } from './owner-attendance.controller';
import { LOAN_REQUEST_REPOSITORY } from '../application/ports/loan-request.repository';
import { BonusRuleService } from '../application/services/bonus-rule.service';
import { LoanService } from '../application/services/loan.service';
import { DepotAssignmentApplier } from '../application/services/depot-assignment-applier.service';
import { DepotAssignmentService } from '../application/services/depot-assignment.service';
import { LoanRequestService } from '../application/services/loan-request.service';
import { BonusRulePrismaRepository } from '../infrastructure/prisma/bonus-rule.prisma.repository';
import { LoanPrismaRepository } from '../infrastructure/prisma/loan.prisma.repository';
import { DepotAssignmentPrismaRepository } from '../infrastructure/prisma/depot-assignment.prisma.repository';
import { DepotDirectoryHttpAdapter } from '../infrastructure/http/depot-directory.http.adapter';
import { LEGAL_ENTITY_DIRECTORY_PORT } from '../application/ports/legal-entity-directory.port';
import { LegalEntityDirectoryHttpAdapter } from '../infrastructure/http/legal-entity-directory.http.adapter';
import { EMPLOYEE_LEGAL_ENTITY_REPOSITORY } from '../application/ports/employee-legal-entity.repository';
import { EmployeeLegalEntityPrismaRepository } from '../infrastructure/prisma/employee-legal-entity.prisma.repository';
import { EmployeeLegalEntityService } from '../application/services/employee-legal-entity.service';
import { EmployeeLegalEntityController } from './employee-legal-entity.controller';
import { LoanRequestPrismaRepository } from '../infrastructure/prisma/loan-request.prisma.repository';
import { SALES_PORT } from '../application/ports/sales.port';
import { OrderSalesHttpAdapter } from '../infrastructure/http/order-sales.http.adapter';
import { IdentityHttpAdapter } from '../infrastructure/http/identity.http.adapter';
import { PERFORMANCE_REPOSITORY } from '../application/ports/performance.repository';
import { PerformanceService } from '../application/services/performance.service';
import { PerformancePrismaRepository } from '../infrastructure/prisma/performance.prisma.repository';
import { AUDIT_REPOSITORY } from '../application/ports/audit.repository';
import { AuditService } from '../application/services/audit.service';
import { AuditPrismaRepository } from '../infrastructure/prisma/audit.prisma.repository';
import { AuditInterceptor } from '../infrastructure/http/audit.interceptor';
import { AI_READ_REPOSITORY } from '../application/ports/ai-read.repository';
import { AiReadPrismaRepository } from '../infrastructure/prisma/ai-read.prisma.repository';
import { AiReadInternalController } from './ai-read-internal.controller';
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
import { DEPARTMENT_REPOSITORY } from '../application/ports/department.repository';
import { DepartmentService } from '../application/services/department.service';
import { DepartmentPrismaRepository } from '../infrastructure/prisma/department.prisma.repository';
import { HolidayController, ShiftController, ShiftRotationController } from './calendar.controller';
import { DepartmentController } from './department.controller';
import { ALLOWANCE_REPOSITORY } from '../application/ports/allowance.repository';
import { AllowanceService } from '../application/services/allowance.service';
import { AllowancePrismaRepository } from '../infrastructure/prisma/allowance.prisma.repository';
import { AllowanceController } from './allowance.controller';
import { NOTIFICATION_PORT } from '../application/ports/notification.port';
import { NotificationHttpAdapter } from '../infrastructure/http/notification.http.adapter';
import { PendingPunchAlert } from '../application/services/pending-punch-alert.service';
import { LEAVE_REPOSITORY } from '../application/ports/leave.repository';
import { LeaveService } from '../application/services/leave.service';
import { LeavePrismaRepository } from '../infrastructure/prisma/leave.prisma.repository';
import { LeaveController, SelfLeaveController } from './leave.controller';
import { DOCUMENT_REPOSITORY } from '../application/ports/document.repository';
import { DocumentService } from '../application/services/document.service';
import { DocumentPrismaRepository } from '../infrastructure/prisma/document.prisma.repository';
import { DocumentController } from './document.controller';
import { ASSET_REPOSITORY } from '../application/ports/asset.repository';
import { AssetService } from '../application/services/asset.service';
import { AssetPrismaRepository } from '../infrastructure/prisma/asset.prisma.repository';
import { AssetController } from './asset.controller';
import { ANNOUNCEMENT_REPOSITORY } from '../application/ports/announcement.repository';
import { AnnouncementService } from '../application/services/announcement.service';
import { AnnouncementPrismaRepository } from '../infrastructure/prisma/announcement.prisma.repository';
import { AnnouncementController, SelfAnnouncementController } from './announcement.controller';
import { SettingsController } from './settings.controller';
import { EmployeesController } from './employees.controller';
import { FaceController, SelfFaceController } from './face.controller';
import { AttendanceController } from './attendance.controller';
import { PayrollController } from './payroll.controller';
import { BonusController, DeductionController } from './adjustment.controller';
import { BonusRuleController, LoanController } from './rules.controller';
import { DepotAssignmentController } from './depot-assignment.controller';
import { DepotMovesInternalController } from './depot-moves-internal.controller';
import { ShiftReminderController } from './shift-reminder.controller';
import { ShiftReminderService } from '../application/services/shift-reminder.service';
import { LoanRequestController, SelfLoanRequestController } from './loan-request.controller';
import { LoanRequestInternalController } from './loan-request-internal.controller';
import { PendingApprovalsController } from './pending-approvals.controller';
import { PENDING_APPROVALS_READER } from '../application/ports/pending-approvals.reader';
import { PendingApprovalsPrismaReader } from '../infrastructure/prisma/pending-approvals.prisma.reader';
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
  // Face plan PR-2: the daily alarm for punches left PENDING more than 48 hours.
  PendingPunchAlert,
  // Face plan PR-4: the local engine (face-service) and the templates it matches against.
  {
    provide: LOCAL_FACE_ENGINE,
    useFactory: (config: HrConfigService) => new FaceServiceClient(config.faceService),
    inject: [HrConfigService],
  },
  FaceTemplateBackfill,
  { provide: EMPLOYEE_REPOSITORY, useClass: EmployeePrismaRepository },
  EmployeeService,
  { provide: FACE_EMBEDDING_REPOSITORY, useClass: FaceEmbeddingPrismaRepository },
  { provide: FACE_MAINTENANCE_REPOSITORY, useClass: FaceMaintenancePrismaRepository },
  FaceMaintenanceService,
  { provide: ATTENDANCE_REPOSITORY, useClass: AttendancePrismaRepository },
  // Face engine bound by FACE_VERIFIER_DRIVER: neo (prod, BiznetGio NEO cloud gallery),
  // onnx (in-process, needs vendored model), or stub (dev/test, deterministic).
  {
    provide: FACE_VERIFIER,
    useFactory: (
      config: HrConfigService,
      local: LocalFaceEngine,
      upkeep: FaceMaintenanceRepository,
    ) => {
      const engine = (() => {
        switch (config.faceVerifierDriver) {
          case 'stub':
            return new StubFaceVerifier(config);
          case 'neo':
            return new NeoFaceProvider(config);
          default:
            return new OnnxArcFaceVerifier(config);
        }
      })();
      // FACE_FALLBACK=shadow: NEO still decides; the local engine is asked too and logged. NEO
      // only — the comparison is between NEO's verdict and ours, and the local drivers' 512-d
      // rows hold no local template to compare with.
      return config.faceFallback === 'shadow' && config.faceServiceUrl && config.faceVerifierDriver === 'neo'
        ? new ShadowFaceVerifier(engine, local, undefined, (sample) => upkeep.recordShadowSample(sample))
        : engine;
    },
    inject: [HrConfigService, LOCAL_FACE_ENGINE, FACE_MAINTENANCE_REPOSITORY],
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
  { provide: DOCUMENT_REPOSITORY, useClass: DocumentPrismaRepository },
  DocumentService,
  { provide: PAYROLL_REPOSITORY, useClass: PayrollPrismaRepository },
  { provide: BONUS_REPOSITORY, useClass: BonusPrismaRepository },
  { provide: DEDUCTION_REPOSITORY, useClass: DeductionPrismaRepository },
  { provide: ALLOWANCE_REPOSITORY, useClass: AllowancePrismaRepository },
  PayrollService,
  AdjustmentService,
  AllowanceService,
  { provide: BONUS_RULE_REPOSITORY, useClass: BonusRulePrismaRepository },
  { provide: LOAN_REPOSITORY, useClass: LoanPrismaRepository },
  { provide: LOAN_REQUEST_REPOSITORY, useClass: LoanRequestPrismaRepository },
  BonusRuleService,
  LoanService,
  LoanRequestService,
  { provide: DEPOT_ASSIGNMENT_REPOSITORY, useClass: DepotAssignmentPrismaRepository },
  DepotAssignmentService,
  { provide: DEPOT_DIRECTORY_PORT, useClass: DepotDirectoryHttpAdapter },
  // HD-5: legal entities live in depot-service; hr dates who works for which one.
  { provide: LEGAL_ENTITY_DIRECTORY_PORT, useClass: LegalEntityDirectoryHttpAdapter },
  { provide: EMPLOYEE_LEGAL_ENTITY_REPOSITORY, useClass: EmployeeLegalEntityPrismaRepository },
  EmployeeLegalEntityService,
  { provide: OWNED_DEPOTS_PORT, useClass: OwnedDepotsHttpAdapter },
  OwnerAttendanceService,
  DepotAssignmentApplier,
  { provide: SALES_PORT, useClass: OrderSalesHttpAdapter },
  // Outbound HR notifications (leave decisions, announcements) via crm-service.
  { provide: NOTIFICATION_PORT, useClass: NotificationHttpAdapter },
  { provide: IDENTITY_PORT, useClass: IdentityHttpAdapter },
  { provide: SUPERVISION_PORT, useClass: SupervisionHttpAdapter },
  { provide: PERFORMANCE_REPOSITORY, useClass: PerformancePrismaRepository },
  PerformanceService,
  { provide: AUDIT_REPOSITORY, useClass: AuditPrismaRepository },
  AuditService,
  { provide: ANALYTICS_REPOSITORY, useClass: AnalyticsPrismaRepository },
  { provide: AI_READ_REPOSITORY, useClass: AiReadPrismaRepository },
  AnalyticsService,
  { provide: HOLIDAY_REPOSITORY, useClass: HolidayPrismaRepository },
  { provide: SHIFT_REPOSITORY, useClass: ShiftPrismaRepository },
  HolidayService,
  ShiftService,
  { provide: DEPARTMENT_REPOSITORY, useClass: DepartmentPrismaRepository },
  DepartmentService,
  { provide: LEAVE_REPOSITORY, useClass: LeavePrismaRepository },
  { provide: PENDING_APPROVALS_READER, useClass: PendingApprovalsPrismaReader },
  LeaveService,
  { provide: ASSET_REPOSITORY, useClass: AssetPrismaRepository },
  AssetService,
  { provide: ANNOUNCEMENT_REPOSITORY, useClass: AnnouncementPrismaRepository },
  AnnouncementService,
  ShiftReminderService,
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
    FaceMaintenanceController,
    SelfFaceController,
    AttendanceController,
    OwnerAttendanceController,
    PayrollController,
    BonusController,
    DeductionController,
    AllowanceController,
    BonusRuleController,
    LoanController,
    SelfLoanRequestController,
    LoanRequestController,
    LoanRequestInternalController,
    PendingApprovalsController,
    DepotAssignmentController,
    DepotMovesInternalController,
    ShiftReminderController,
    PerformanceController,
    AuditController,
    ReportsController,
    AiReadInternalController,
    HolidayController,
    ShiftController,
    ShiftRotationController,
    DepartmentController,
    EmployeeLegalEntityController,
    SelfLeaveController,
    LeaveController,
    DocumentController,
    AssetController,
    SelfAnnouncementController,
    AnnouncementController,
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
