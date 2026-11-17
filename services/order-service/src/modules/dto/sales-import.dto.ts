import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
  Max,
} from 'class-validator';
import { INT4_MAX, decimalMax } from '@hydromart/platform';

/** One row of the historical sales-transaction import wizard. */
export class ImportSalesTransactionRowDto {
  @ApiProperty({ maxLength: 60, description: "The old system's receipt/invoice number." })
  @IsString()
  @MaxLength(60)
  externalRef!: string;

  @ApiProperty({ description: 'When the original sale happened (ISO 8601).' })
  @IsISO8601()
  occurredAt!: string;

  @ApiProperty({ required: false, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  customerLabel?: string;

  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  productLabel!: string;

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
  quantity!: number;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  @Max(decimalMax(12, 2))
  unitPrice!: number;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  @Max(decimalMax(12, 2))
  lineTotal!: number;

  @ApiProperty({ required: false, maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  paymentMethod?: string;
}

export class ImportSalesTransactionsDto {
  @ApiProperty({ format: 'uuid', description: 'Depot the imported transactions belong to.' })
  @IsUUID()
  depotId!: string;

  @ApiProperty({ type: [ImportSalesTransactionRowDto], description: 'Max 500 rows per file.' })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ImportSalesTransactionRowDto)
  rows!: ImportSalesTransactionRowDto[];
}

export class ListImportedSalesQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  depotId!: string;

  @ApiProperty({ description: 'Inclusive lower bound (ISO 8601).' })
  @IsISO8601()
  from!: string;

  @ApiProperty({ description: 'Exclusive upper bound (ISO 8601).' })
  @IsISO8601()
  to!: string;
}

export class SummaryByMethodQueryDto {
  @ApiProperty({ required: false, description: 'Inclusive lower bound (ISO 8601).' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiProperty({ required: false, description: 'Exclusive upper bound (ISO 8601).' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
