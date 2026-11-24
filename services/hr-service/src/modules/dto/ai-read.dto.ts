import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsUUID, Matches } from 'class-validator';
import { IsNotBefore, IsWithinDays } from '@hydromart/platform';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const ids = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : value;

/** HD-6 H5: 1 to 100 depots, as the dashboard's other internal reads take them. */
class DepotsQueryDto {
  @ApiProperty({ description: 'Comma-separated depot ids (1 to 100).' })
  @Transform(ids)
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  depotIds!: string[];
}

export class AiAttendanceQueryDto extends DepotsQueryDto {
  @ApiProperty({ example: '2026-11-01', description: 'First day, YYYY-MM-DD.' })
  @Matches(DAY)
  from!: string;

  @ApiProperty({ example: '2026-11-30', description: 'Last day (included), not before from, at most 366 days.' })
  @Matches(DAY)
  @IsNotBefore('from')
  @IsWithinDays('from')
  to!: string;
}

export class AiMonthQueryDto extends DepotsQueryDto {
  @ApiProperty({ example: '2026-11' })
  @Matches(MONTH, { message: 'month harus format YYYY-MM' })
  month!: string;
}

export class AiAttendanceResponseDto {
  @ApiProperty({ type: 'array', items: { type: 'object' } })
  rows!: Record<string, unknown>[];
  @ApiProperty()
  rolledUp!: boolean;
}
