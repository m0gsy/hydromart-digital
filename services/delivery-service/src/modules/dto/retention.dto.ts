import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * Retention sweep body. admin-service computes the cutoff from the retention policy;
 * delivery-service only owns the rows, never the rule.
 */
export class PurgeProofsDto {
  @ApiProperty({ type: String, format: 'date-time' })
  @IsISO8601()
  cutoff!: string;
}

/**
 * UU PDP item 13 — who to forget. `phone` rides along because a delivery created before the
 * customer registered carries the number and no id, and that is the row the audit counted.
 */
export class PdpAnonymiseDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  customerId!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string | null;
}
