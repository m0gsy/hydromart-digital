import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601 } from 'class-validator';

/**
 * Retention sweep body. admin-service computes the cutoff from the retention policy;
 * delivery-service only owns the rows, never the rule.
 */
export class PurgeProofsDto {
  @ApiProperty({ type: String, format: 'date-time' })
  @IsISO8601()
  cutoff!: string;
}
