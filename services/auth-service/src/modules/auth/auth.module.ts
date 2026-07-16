import { Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { AuthConfigService } from '../../config/auth-config.service';
import { AUTH_TOKENS } from '../../application/tokens';
import { AccountService } from '../../application/services/account.service';
import { AuditService } from '../../application/services/audit.service';
import { LoginService } from '../../application/services/login.service';
import { OtpService } from '../../application/services/otp.service';
import { OtpVerificationService } from '../../application/services/otp-verification.service';
import { RegistrationService } from '../../application/services/registration.service';
import { SessionService } from '../../application/services/session.service';
import { TokenService } from '../../application/services/token.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditLogPrismaRepository } from '../../infrastructure/prisma/repositories/audit-log.prisma.repository';
import { CustomerPrismaRepository } from '../../infrastructure/prisma/repositories/customer.prisma.repository';
import { OtpTokenPrismaRepository } from '../../infrastructure/prisma/repositories/otp-token.prisma.repository';
import { RefreshTokenPrismaRepository } from '../../infrastructure/prisma/repositories/refresh-token.prisma.repository';
import { AccessTokenSigner } from '../../infrastructure/security/access-token-signer';
import { CryptoService } from '../../infrastructure/security/crypto.service';
import { GoogleVerifier } from '../../infrastructure/security/google-verifier';
import { SystemClock } from '../../infrastructure/security/system-clock';
import { ConsoleOtpDeliveryAdapter } from '../../infrastructure/otp-delivery/console-otp-delivery.adapter';
import { SmsOtpDeliveryAdapter } from '../../infrastructure/otp-delivery/sms-otp-delivery.adapter';
import { WhatsappOtpDeliveryAdapter } from '../../infrastructure/otp-delivery/whatsapp-otp-delivery.adapter';
import { CustomerNotificationHttpAdapter } from '../../infrastructure/notification/customer-notification.http.adapter';
import { LocalDiskStorageAdapter } from '../../infrastructure/storage/local-disk-storage.adapter';
import { S3StorageAdapter } from '../../infrastructure/storage/s3-storage.adapter';
import { StoragePort } from '../../application/ports/storage.port';
import { AccountController } from './account.controller';
import { AuthController } from './auth.controller';
import { AvatarController } from './avatar.controller';

/** Binds each application port to its infrastructure adapter (dependency inversion). */
const adapterProviders: Provider[] = [
  PrismaService,
  AuthConfigService,
  ConsoleOtpDeliveryAdapter,
  WhatsappOtpDeliveryAdapter,
  SmsOtpDeliveryAdapter,
  { provide: AUTH_TOKENS.CustomerRepository, useClass: CustomerPrismaRepository },
  { provide: AUTH_TOKENS.OtpTokenRepository, useClass: OtpTokenPrismaRepository },
  { provide: AUTH_TOKENS.RefreshTokenRepository, useClass: RefreshTokenPrismaRepository },
  { provide: AUTH_TOKENS.AuditLogRepository, useClass: AuditLogPrismaRepository },
  { provide: AUTH_TOKENS.CryptoPort, useClass: CryptoService },
  { provide: AUTH_TOKENS.ClockPort, useClass: SystemClock },
  { provide: AUTH_TOKENS.AccessTokenSignerPort, useClass: AccessTokenSigner },
  { provide: AUTH_TOKENS.GoogleVerifierPort, useClass: GoogleVerifier },
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
      WhatsappOtpDeliveryAdapter,
      SmsOtpDeliveryAdapter,
    ],
    useFactory: (
      config: AuthConfigService,
      consoleAdapter: ConsoleOtpDeliveryAdapter,
      whatsapp: WhatsappOtpDeliveryAdapter,
      sms: SmsOtpDeliveryAdapter,
    ) => {
      switch (config.otpDeliveryChannel) {
        case 'whatsapp':
          return whatsapp;
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
  AuditService,
];

const globalGuards: Provider[] = [
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController, AccountController, AvatarController],
  providers: [...adapterProviders, ...applicationServices, ...globalGuards],
  exports: [PrismaService, AuthConfigService],
})
export class AuthModule {}
