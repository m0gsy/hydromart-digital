import { Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

// The shared guard, not a local copy: it is the one that resolves @Can against the live
// capability matrix, and a second implementation is exactly the drift this phase removes.
import {
  AUDIT_MUTATION_SINK,
  AuditMutationsInterceptor,
  DepotScopeGuard,
  RolesGuard,
} from '@hydromart/platform';

import { AuthAuditMutationSink } from '../../infrastructure/audit-mutation.sink';

import { AuthConfigService } from '../../config/auth-config.service';
import { AUTH_TOKENS } from '../../application/tokens';
import { AccountService } from '../../application/services/account.service';
import { PhoneChangeService } from '../../application/services/phone-change.service';
import { AuditService } from '../../application/services/audit.service';
import { ConsentService } from '../../application/services/consent.service';
import { AccessMatrixService } from '../../application/services/access-matrix.service';
import { DataSubjectService } from '../../application/services/data-subject.service';
import { LoginService } from '../../application/services/login.service';
import { OtpService } from '../../application/services/otp.service';
import { OtpVerificationService } from '../../application/services/otp-verification.service';
import { RegistrationService } from '../../application/services/registration.service';
import { SessionService } from '../../application/services/session.service';
import { TokenService } from '../../application/services/token.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { InternalAuthGuard } from '../../common/guards/internal-auth.guard';
import { ConsentController } from './consent.controller';
import { AccessController } from './access.controller';
import { DataSubjectController } from './data-subject.controller';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditLogPrismaRepository } from '../../infrastructure/prisma/repositories/audit-log.prisma.repository';
import { ConsentPrismaRepository } from '../../infrastructure/prisma/repositories/consent.prisma.repository';
import { CapabilityOverridePrismaRepository } from '../../infrastructure/prisma/repositories/capability-override.prisma.repository';
import { DataSubjectRequestPrismaRepository } from '../../infrastructure/prisma/repositories/data-subject-request.prisma.repository';
import { CustomerDataHttpAdapter } from '../../infrastructure/http/customer-data.http.adapter';
import { HrDirectoryHttpAdapter } from '../../infrastructure/http/hr-directory.http.adapter';
import {
  erasureExecutorProvider,
  erasureExemptionProvider,
} from '../../infrastructure/http/erasure-executor.registry';
import { HR_DIRECTORY_PORT } from '../../application/ports/hr-directory.port';
import { CustomerPrismaRepository } from '../../infrastructure/prisma/repositories/customer.prisma.repository';
import { OtpTokenPrismaRepository } from '../../infrastructure/prisma/repositories/otp-token.prisma.repository';
import { RefreshTokenPrismaRepository } from '../../infrastructure/prisma/repositories/refresh-token.prisma.repository';
import { AccessTokenSigner } from '../../infrastructure/security/access-token-signer';
import { CryptoService } from '../../infrastructure/security/crypto.service';
import { SystemClock } from '../../infrastructure/security/system-clock';
import { ConsoleOtpDeliveryAdapter } from '../../infrastructure/otp-delivery/console-otp-delivery.adapter';
import { SmsOtpDeliveryAdapter } from '../../infrastructure/otp-delivery/sms-otp-delivery.adapter';
import { ZenzivaOtpDeliveryAdapter } from '../../infrastructure/otp-delivery/zenziva-otp-delivery.adapter';
import { CustomerNotificationHttpAdapter } from '../../infrastructure/notification/customer-notification.http.adapter';
import { LocalDiskStorageAdapter } from '../../infrastructure/storage/local-disk-storage.adapter';
import { S3StorageAdapter } from '../../infrastructure/storage/s3-storage.adapter';
import { StoragePort } from '../../application/ports/storage.port';
import { AccountController } from './account.controller';
import { AuditController } from './audit.controller';
import { AuthController } from './auth.controller';
import { AvatarController } from './avatar.controller';
import { InternalAccountController } from './internal.controller';

/** Binds each application port to its infrastructure adapter (dependency inversion). */
const adapterProviders: Provider[] = [
  PrismaService,
  AuthConfigService,
  ConsoleOtpDeliveryAdapter,
  SmsOtpDeliveryAdapter,
  ZenzivaOtpDeliveryAdapter,
  InternalAuthGuard,
  { provide: AUTH_TOKENS.CustomerRepository, useClass: CustomerPrismaRepository },
  { provide: AUTH_TOKENS.OtpTokenRepository, useClass: OtpTokenPrismaRepository },
  { provide: AUTH_TOKENS.RefreshTokenRepository, useClass: RefreshTokenPrismaRepository },
  { provide: AUTH_TOKENS.AuditLogRepository, useClass: AuditLogPrismaRepository },
  {
    provide: AUTH_TOKENS.DataSubjectRequestRepository,
    useClass: DataSubjectRequestPrismaRepository,
  },
  { provide: AUTH_TOKENS.CustomerDataPort, useClass: CustomerDataHttpAdapter },
  { provide: HR_DIRECTORY_PORT, useClass: HrDirectoryHttpAdapter },
  // The erasure registry: one entry per service that holds the person who asked to be
  // forgotten, plus the written exemptions. Absent datasets are reported UNENFORCED.
  erasureExecutorProvider,
  erasureExemptionProvider,
  { provide: AUTH_TOKENS.ConsentRepository, useClass: ConsentPrismaRepository },
  {
    provide: AUTH_TOKENS.CapabilityOverrideRepository,
    useClass: CapabilityOverridePrismaRepository,
  },
  { provide: AUTH_TOKENS.CryptoPort, useClass: CryptoService },
  { provide: AUTH_TOKENS.ClockPort, useClass: SystemClock },
  { provide: AUTH_TOKENS.AccessTokenSignerPort, useClass: AccessTokenSigner },
  { provide: AUTH_TOKENS.CustomerNotificationPort, useClass: CustomerNotificationHttpAdapter },
  {
    provide: AUTH_TOKENS.Storage,
    inject: [AuthConfigService],
    useFactory: (config: AuthConfigService): StoragePort =>
      config.storageDriver === 's3'
        ? new S3StorageAdapter(config)
        : new LocalDiskStorageAdapter(config),
  },
  {
    provide: AUTH_TOKENS.OtpDeliveryPort,
    inject: [
      AuthConfigService,
      ConsoleOtpDeliveryAdapter,
      SmsOtpDeliveryAdapter,
      ZenzivaOtpDeliveryAdapter,
    ],
    useFactory: (
      config: AuthConfigService,
      consoleAdapter: ConsoleOtpDeliveryAdapter,
      sms: SmsOtpDeliveryAdapter,
      zenziva: ZenzivaOtpDeliveryAdapter,
    ) => {
      switch (config.otpDeliveryChannel) {
        case 'zenziva':
          return zenziva;
        case 'sms':
          return sms;
        default:
          return consoleAdapter;
      }
    },
  },
];

const applicationServices: Provider[] = [
  OtpService,
  SessionService,
  RegistrationService,
  LoginService,
  OtpVerificationService,
  TokenService,
  AccountService,
  PhoneChangeService,
  AuditService,
  DataSubjectService,
  ConsentService,
  AccessMatrixService,
];

const globalGuards: Provider[] = [
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
  // Every other service resolves a multi-depot caller's depots with this guard; auth-service
  // was the one that did not, and it is the service that answers `/auth/staff` and
  // `/auth/drivers`. Without it `user.depotIds` was never populated here, so the staff
  // directory fell back to the account's own `assignedDepotId` column — which a manager
  // scoped through the hierarchy does not have, and every such read answered 403.
  { provide: APP_GUARD, useClass: DepotScopeGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [
    AuthController,
    AccountController,
    AvatarController,
    AuditController,
    InternalAccountController,
    DataSubjectController,
    ConsentController,
    AccessController,
  ],
  providers: [
    // CA-2-67: role grants and RBAC-matrix edits reached no trail at all. See
    // AuthAuditMutationSink for why this one writes to the table instead of over HTTP.
    { provide: AUDIT_MUTATION_SINK, useClass: AuthAuditMutationSink },
    AuditMutationsInterceptor,
    ...adapterProviders,
    ...applicationServices,
    ...globalGuards,
  ],
  exports: [PrismaService, AuthConfigService],
})
export class AuthModule {}
