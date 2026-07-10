import { Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard, RolesGuard } from '@hydromart/platform';

import { CustomerConfigService } from '../config/customer-config.service';
import { CUSTOMER_TOKENS } from '../application/tokens';
import { AddressService } from '../application/services/address.service';
import { NotificationService } from '../application/services/notification.service';
import { ProfileService } from '../application/services/profile.service';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { AddressPrismaRepository } from '../infrastructure/prisma/address.prisma.repository';
import { NotificationPrismaRepository } from '../infrastructure/prisma/notification.prisma.repository';
import { ProfilePrismaRepository } from '../infrastructure/prisma/profile.prisma.repository';
import { AddressController } from './address.controller';
import { ProfileController } from './profile.controller';

const providers: Provider[] = [
  PrismaService,
  CustomerConfigService,
  ProfileService,
  AddressService,
  NotificationService,
  { provide: CUSTOMER_TOKENS.ProfileRepository, useClass: ProfilePrismaRepository },
  { provide: CUSTOMER_TOKENS.AddressRepository, useClass: AddressPrismaRepository },
  { provide: CUSTOMER_TOKENS.NotificationPreferenceRepository, useClass: NotificationPrismaRepository },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [ProfileController, AddressController],
  providers,
  exports: [PrismaService, CustomerConfigService],
})
export class CustomerModule {}
