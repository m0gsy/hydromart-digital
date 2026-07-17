import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsString, Max, MaxLength, Min } from 'class-validator';

import { SecurityPolicyRecord } from '../../application/ports/security-policy.repository';

/* ---------- Requests ---------- */

export class SaveSecurityPolicyDto {
  @ApiProperty({ example: 15, minimum: 1, maximum: 1440, description: 'Idle minutes before sign-out.' })
  @IsInt()
  @Min(1)
  @Max(1440)
  idleTimeoutMinutes!: number;

  @ApiProperty({ example: true, description: 'Whether 2FA is mandatory for HQ accounts.' })
  @IsBoolean()
  require2fa!: boolean;

  @ApiProperty({ type: [String], example: ['103.21.0.0/16'], description: 'CIDR allowlist (empty = anywhere).' })
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  ipAllowlist!: string[];
}

/* ---------- Responses ---------- */

export class SecurityPolicyDto {
  @ApiProperty({ example: 15 })
  idleTimeoutMinutes!: number;
  @ApiProperty({ example: true })
  require2fa!: boolean;
  @ApiProperty({ type: [String] })
  ipAllowlist!: string[];
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  static from(record: SecurityPolicyRecord): SecurityPolicyDto {
    return {
      idleTimeoutMinutes: record.idleTimeoutMinutes,
      require2fa: record.require2fa,
      ipAllowlist: record.ipAllowlist,
      updatedAt: record.updatedAt,
    };
  }
}
