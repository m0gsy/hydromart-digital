import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, Matches } from 'class-validator';

/** Query for the courier weekly performance card (design 4c). */
export class PerformanceQueryDto {
  @ApiProperty({
    example: '2026-07-13',
    description: 'First day (Monday) of the WIB week, YYYY-MM-DD.',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'weekStart must be YYYY-MM-DD' })
  weekStart!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: "The courier's depot, to rank them on the depot leaderboard. Omit to skip rank.",
  })
  @IsOptional()
  @IsUUID()
  depotId?: string;
}
