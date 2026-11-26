import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;
const trimmed = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

export class GenerateBillsDto {
  @ApiProperty({ example: '2026-11', description: 'A closed WIB month, YYYY-MM.' })
  @Matches(MONTH_KEY, { message: 'month must be YYYY-MM' })
  month!: string;
}

export class VoidBillDto {
  @ApiProperty({ example: 'Salah badan hukum', description: 'Why the bill is withdrawn; kept on the bill.' })
  @Transform(trimmed)
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}

export class PartnerBillListQueryDto {
  @ApiPropertyOptional({ example: '2026-11' })
  @IsOptional()
  @Matches(MONTH_KEY, { message: 'month must be YYYY-MM' })
  month?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  legalEntityId?: string;

  @ApiPropertyOptional({ enum: ['DRAFT', 'SENDING', 'SENT', 'VOID'] })
  @IsOptional()
  @IsIn(['DRAFT', 'SENDING', 'SENT', 'VOID'])
  status?: 'DRAFT' | 'SENDING' | 'SENT' | 'VOID';
}

export class PartnerBillBasisResponseDto {
  @ApiProperty({ example: '2026-11-01' })
  from!: string;
  @ApiProperty({ example: '2026-11-30' })
  to!: string;
  @ApiProperty()
  rows!: number;
  @ApiProperty()
  reversalRows!: number;
  @ApiProperty()
  reversalIdr!: number;
  @ApiProperty({ type: [String], description: 'The owner accounts the bill goes to for this depot.' })
  ownerIds!: string[];
}

export class PartnerBillLineResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ format: 'uuid' })
  depotId!: string;
  @ApiProperty()
  label!: string;
  @ApiProperty({ description: 'Whole rupiah; negative on a line whose reversals exceeded its commission.' })
  amountIdr!: number;
  @ApiProperty({ type: PartnerBillBasisResponseDto })
  basis!: PartnerBillBasisResponseDto;
}

export class PartnerBillBankResponseDto {
  @ApiProperty()
  bankName!: string;
  @ApiProperty()
  bankAccountNumber!: string;
  @ApiProperty()
  bankAccountHolder!: string;
}

export class PartnerBillResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ format: 'uuid' })
  legalEntityId!: string;
  @ApiProperty()
  legalEntityName!: string;
  @ApiProperty({ example: '2026-11' })
  month!: string;
  @ApiProperty({ enum: ['DRAFT', 'SENDING', 'SENT', 'VOID'] })
  status!: string;
  @ApiProperty()
  totalIdr!: number;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
  @ApiProperty({ type: String, nullable: true })
  approvedBy!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  approvedAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  sentAt!: Date | null;
  @ApiProperty({ type: String, nullable: true })
  voidReason!: string | null;
  @ApiProperty({ type: PartnerBillBankResponseDto, nullable: true, description: 'Where to pay, once the bill was sent.' })
  bank!: PartnerBillBankResponseDto | null;
  @ApiProperty({ description: 'How many owner accounts the bill was sent to.' })
  recipients!: number;
  @ApiPropertyOptional({ type: [PartnerBillLineResponseDto] })
  lines?: PartnerBillLineResponseDto[];
}

export class GenerateBillsResponseDto {
  @ApiProperty({ example: '2026-11' })
  month!: string;
  @ApiProperty({ description: 'Drafts made by this run.' })
  made!: number;
  @ApiProperty({ description: 'Entities that already had a live bill for the month.' })
  existing!: number;
  @ApiProperty({ description: 'Entities whose month nets to zero or less: no bill.' })
  skippedZero!: number;
  @ApiProperty({ description: 'Depots with commission that belong to no legal entity yet.' })
  unassigned!: number;
  @ApiProperty({ description: 'COMMISSION ledger rows in the month; 0 means no commission scheme produced any.' })
  commissionRows!: number;
  @ApiProperty({ description: 'Legal entities depot-service could not describe: their depots were not billed.' })
  unreadable!: number;
  @ApiProperty({ description: 'Billed depots with no franchise owner recorded.' })
  noOwner!: number;
  @ApiProperty({ type: [String], description: 'Their depot codes.' })
  noOwnerDepots!: string[];
}
