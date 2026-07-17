import { ApiProperty } from '@nestjs/swagger';

import { CustomerStatus } from '../../../domain/customer/customer-status.enum';
import { Role } from '../../../domain/customer/role.enum';
import { OtpChallengeResult, PublicCustomer, SessionResult } from '../../../application/results';
import { SessionInfo } from '../../../application/services/session.service';

export class OtpChallengeResponseDto {
  @ApiProperty({ example: '+62812****890' })
  phoneMasked!: string;

  @ApiProperty({ example: 300, description: 'Seconds until the code expires.' })
  expiresInSeconds!: number;

  static from(result: OtpChallengeResult): OtpChallengeResponseDto {
    return { phoneMasked: result.phoneMasked, expiresInSeconds: result.expiresInSeconds };
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

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  static from(customer: PublicCustomer): PublicCustomerDto {
    return { ...customer };
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
      customer: PublicCustomerDto.from(result.customer),
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
