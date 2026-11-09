import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import {
  PolicyChangeRecord,
  PolicyChangeStatus,
} from '../../application/ports/policy-change.repository';

export class ListPolicyChangesQueryDto {
  @ApiPropertyOptional({ enum: ['PENDING', 'APPLIED', 'REJECTED'] })
  @IsOptional()
  @IsIn(['PENDING', 'APPLIED', 'REJECTED'])
  status?: PolicyChangeStatus;
}

export class DecidePolicyChangeDto {
  @ApiPropertyOptional({ maxLength: 500, description: 'Why it was approved or rejected.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** What a policy PUT answers now: nothing changed yet, a second super admin has to decide. */
export class PolicyChangeRequestedDto {
  @ApiProperty({ example: true })
  pending!: true;
  @ApiProperty({ format: 'uuid' })
  requestId!: string;
}

export class PolicyChangeDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['SECURITY_POLICY', 'RETENTION_POLICY'] }) kind!: string;
  @ApiProperty({ nullable: true, type: String }) targetId!: string | null;
  @ApiProperty({ type: Object }) payload!: Record<string, unknown>;
  @ApiProperty({ enum: ['PENDING', 'APPLIED', 'REJECTED'] }) status!: string;
  @ApiProperty() requestedBy!: string;
  @ApiProperty({ format: 'date-time', type: String }) requestedAt!: Date;
  @ApiProperty({ nullable: true, type: String }) decidedBy!: string | null;
  @ApiProperty({ nullable: true, format: 'date-time', type: String }) decidedAt!: Date | null;
  @ApiProperty({ nullable: true, type: String }) decisionNote!: string | null;

  static from(r: PolicyChangeRecord): PolicyChangeDto {
    return { ...r };
  }
}
