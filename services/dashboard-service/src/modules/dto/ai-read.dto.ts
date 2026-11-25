import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

import { ANSWER_STATUSES } from '../../application/ai-read/envelope';
import { PERIOD_UNITS } from '../../application/ai-read/period';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The period of a question (contracts/ai-v1/read.openapi.json): `period` (+ `date`) or
 * `from`+`to`. Which combinations are valid is `parsePeriod`'s to say, so a bad one is one 400
 * with one message, not a pile of validator errors.
 */
export class PeriodQueryDto {
  @ApiPropertyOptional({ enum: PERIOD_UNITS })
  @IsOptional()
  @IsString()
  period?: string;

  @ApiPropertyOptional({ example: '2026-11-25', description: 'Any day inside the period; default today (WIB).' })
  @IsOptional()
  @Matches(DAY)
  date?: string;

  @ApiPropertyOptional({ example: '2026-11-01' })
  @IsOptional()
  @Matches(DAY)
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-30' })
  @IsOptional()
  @Matches(DAY)
  to?: string;

  @ApiPropertyOptional({ enum: ['depot'], description: 'Per-depot answer; only for metrics that are plain depot sums (see the contract), 400 otherwise.' })
  @IsOptional()
  @IsString()
  split?: string;
}

/** The money route: a period, and which metric of the money group. An id outside it is a 404, not a 400. */
export class MoneyQueryDto extends PeriodQueryDto {
  @ApiProperty({ example: 'P-01', description: 'A metric of the money group (see the contract).' })
  @IsString()
  metric!: string;
}

/** The franchise route (H5): a period, and which metric of the franchise group. An id outside it is a 404. */
export class FranchiseQueryDto extends PeriodQueryDto {
  @ApiProperty({ example: 'W-01', description: 'A metric of the franchise group (see the contract).' })
  @IsString()
  metric!: string;
}

/** The HR route (H5): a period, and which metric of the HR group. An id outside it is a 404. */
export class HrQueryDto extends PeriodQueryDto {
  @ApiProperty({ example: 'H-01', description: 'A metric of the HR group (see the contract).' })
  @IsString()
  metric!: string;
}

class PeriodDto {
  @ApiProperty({ enum: [...PERIOD_UNITS, 'range'] })
  unit!: string;
  @ApiProperty({ example: '2026-11-01' })
  from!: string;
  @ApiProperty({ example: '2026-11-30' })
  to!: string;
  @ApiProperty({ example: 'Asia/Jakarta' })
  timeZone!: string;
  @ApiProperty({ format: 'date-time' })
  fromAt!: string;
  @ApiProperty({ format: 'date-time' })
  toAt!: string;
}

class ScopeDto {
  @ApiProperty({ type: [String] })
  depotIds!: string[];
  @ApiProperty({ type: [String] })
  legalEntityIds!: string[];
}

export class AnswerEnvelopeDto {
  @ApiProperty({ example: 'meta.scope' })
  metricId!: string;
  @ApiProperty({ type: PeriodDto })
  period!: PeriodDto;
  @ApiProperty({ type: ScopeDto })
  scope!: ScopeDto;
  @ApiProperty({ nullable: true, description: 'Null with belum_ada or ditahan, never 0.' })
  value!: unknown;
  @ApiProperty({ enum: ANSWER_STATUSES })
  status!: string;
  @ApiProperty({ example: 'depot' })
  unit!: string;
  @ApiProperty({ format: 'date-time' })
  asOf!: string;
  @ApiPropertyOptional()
  reason?: string;
}
