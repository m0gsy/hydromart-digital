import { ApiProperty } from '@nestjs/swagger';

import { capabilitiesFor } from '@hydromart/access';

import { CustomerStatus } from '../../../domain/customer/customer-status.enum';
import { Role } from '../../../domain/customer/role.enum';
import { OtpChallengeResult, PublicCustomer, SessionResult } from '../../../application/results';
import { SessionInfo } from '../../../application/services/session.service';

export class OtpChallengeResponseDto {
  @ApiProperty({ example: '+62812****890' })
  phoneMasked!: string;

  @ApiProperty({ example: 300, description: 'Seconds until the code expires.' })
  expiresInSeconds!: number;

  @ApiProperty({
    example: 60,
    description: 'Seconds before another code may be requested. E4: the client shows this rather than its own copy.',
  })
  resendCooldownSeconds!: number;

  @ApiProperty({
    example: false,
    description:
      'True when the SMS gateway had not answered by the time we replied. The code is valid ' +
      'and probably on its way; the screen can say so instead of claiming instant delivery.',
  })
  deliveryPending!: boolean;

  static from(result: OtpChallengeResult): OtpChallengeResponseDto {
    return {
      phoneMasked: result.phoneMasked,
      expiresInSeconds: result.expiresInSeconds,
      resendCooldownSeconds: result.resendCooldownSeconds,
      deliveryPending: result.deliveryPending ?? false,
    };
  }
}

export class PublicCustomerDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '+628123456789' })
  phone!: string;

  @ApiProperty({ nullable: true, example: 'budi@example.com' })
  email!: string | null;

  @ApiProperty({ nullable: true, example: 'Budi Santoso' })
  fullName!: string | null;

  @ApiProperty({ enum: Role })
  role!: Role;

  @ApiProperty({ enum: CustomerStatus })
  status!: CustomerStatus;

  @ApiProperty({ nullable: true })
  avatarUrl!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true, description: 'Depot this staff member is assigned to.' })
  assignedDepotId!: string | null;

  @ApiProperty({ nullable: true, example: 'MOTOR', description: 'STAFF_DEPOT vehicle type (free text).' })
  vehicleType!: string | null;

  @ApiProperty({ nullable: true, example: 'B 1234 ABC', description: 'STAFF_DEPOT vehicle plate number.' })
  plateNumber!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({
    type: [String],
    required: false,
    description:
      'Capabilities this account holds under the CURRENT matrix (defaults + super-admin ' +
      'overrides). Sent on the session and /auth/me only, so the console gates on the same ' +
      'answer the guards give instead of recomputing it from a stale compiled map.',
  })
  capabilities?: string[];

  static from(customer: PublicCustomer): PublicCustomerDto {
    return { ...customer };
  }

  /** As `from`, plus the live capability list. Use on session + profile responses. */
  static withCapabilities(customer: PublicCustomer): PublicCustomerDto {
    return { ...customer, capabilities: capabilitiesFor(customer.role) };
  }
}

export class SessionResponseDto {
  @ApiProperty({ example: 'Bearer' })
  tokenType!: 'Bearer';

  @ApiProperty({ description: 'Short-lived JWT access token.' })
  accessToken!: string;

  @ApiProperty({ example: 900, description: 'Access-token lifetime in seconds.' })
  expiresIn!: number;

  @ApiProperty({ description: 'Long-lived opaque refresh token (rotated on use).' })
  refreshToken!: string;

  @ApiProperty({ type: PublicCustomerDto })
  customer!: PublicCustomerDto;

  static from(result: SessionResult): SessionResponseDto {
    return {
      tokenType: result.tokenType,
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      refreshToken: result.refreshToken,
      customer: PublicCustomerDto.withCapabilities(result.customer),
    };
  }
}

export class SessionInfoDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt!: Date;

  @ApiProperty({ nullable: true })
  ipAddress!: string | null;

  @ApiProperty({ nullable: true })
  userAgent!: string | null;

  static from(session: SessionInfo): SessionInfoDto {
    return { ...session };
  }
}

export class MessageResponseDto {
  @ApiProperty({ example: 'Signed out.' })
  message!: string;
}
