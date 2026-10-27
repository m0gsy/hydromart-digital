import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsISO8601 } from 'class-validator';

/** Datasets this service can answer. METER_READINGS is not one of them — see ReportTableService. */
export const REPORT_TABLE_DATASETS = ['STOCK_LEVELS'] as const;
export type ReportTableDataset = (typeof REPORT_TABLE_DATASETS)[number];

export class ReportTableQueryDto {
  @ApiProperty({ enum: REPORT_TABLE_DATASETS })
  @IsIn(REPORT_TABLE_DATASETS)
  dataset!: ReportTableDataset;

  @ApiProperty({ description: 'Inclusive range start (ISO 8601).' })
  @IsISO8601()
  from!: string;

  @ApiProperty({ description: 'Exclusive range end (ISO 8601).' })
  @IsISO8601()
  to!: string;
}
