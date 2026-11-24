import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsOptional, IsString, IsUUID, Length } from 'class-validator';

/**
 * HD-11: the person dashboard-service asks for, read from their verified token. Each queue
 * applies its own rule about what that person can never decide (what they raised themselves).
 */
export class PendingSummaryQueryDto {
  @ApiProperty({ format: 'uuid', description: 'The account asking.' })
  @IsUUID('all')
  actorId!: string;

  @ApiProperty({ description: "That account's role." })
  @IsString()
  @Length(1, 64)
  role!: string;

  /**
   * Never empty: an account responsible for no depot is answered 0 by the caller, so an empty
   * list here can only be a mistake, and it is refused rather than read as "every depot".
   */
  @ApiPropertyOptional({
    description: 'Comma-separated depots the account oversees (at most 100). Absent: the whole network.',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : value,
  )
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  depotIds?: string[];
}
