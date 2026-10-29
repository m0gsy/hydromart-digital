import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class RequestWithdrawalDto {
  @ApiProperty({ example: 8420000, description: 'IDR amount to withdraw (positive).' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  amount!: number;
  /*
   * PYO-3: the destination used to be typed here, per request, and never checked. It now
   * comes from the verified account on file, so there is nothing for the caller to send —
   * and `forbidNonWhitelisted` refuses a body that still tries.
   */
}

/**
 * The bank's answer for one withdrawal. FAILED re-credits the balance, so the reason rides
 * along and lands on the compensating ledger row — there is no "reason" column, and the row
 * that gives the money back is the right place for the sentence that explains it.
 */
export class SettleWithdrawalDto {
  @ApiPropertyOptional({
    example: 'Rekening tujuan tidak aktif',
    description: 'Why the transfer was rejected. Recorded on the compensating credit.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class ReleasePayoutDto {
  @ApiProperty({ format: 'uuid', description: 'Franchise owner whose balance HQ is releasing.' })
  @IsUUID()
  franchiseOwnerId!: string;

  /*
   * CA-2-63: the destination, which this release used to record as the literal string
   * "Rilis HQ" — the name of the button, in the column the schema describes as the masked
   * bank account. Optional here because the owner's own last cash-out is the honest
   * default; when they have never cashed out, the service refuses rather than inventing a
   * placeholder for money that is already leaving the balance.
   */
  @ApiPropertyOptional({
    example: 'BCA ···· 4821',
    description: "Masked destination account. Defaults to the owner's most recent cash-out.",
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  bankAccountRef?: string;
}

/** One owner's share of an order's revenue. */
export class RevenueOwnerDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  ownerId!: string;

  @ApiProperty({ example: 60, description: 'Percent, above 0 and at most 100, two decimals.' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(100)
  sharePct!: number;

  @ApiProperty()
  @IsBoolean()
  isPrimary!: boolean;
}

/** Internal push from order-service when an order reaches COMPLETED (design 6a). */
export class OrderRevenueDto {
  @ApiProperty({ format: 'uuid', description: 'Completed order; also the idempotency key.' })
  @IsUUID()
  orderId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Sole owner of the fulfilling depot (an older order-service). Send owners[] for a depot with several.',
  })
  @ValidateIf((o: OrderRevenueDto) => o.owners === undefined)
  @IsUUID()
  franchiseOwnerId?: string;

  @ApiPropertyOptional({
    type: [RevenueOwnerDto],
    description:
      'Every owner of the fulfilling depot as of completion, shares summing to 100. Wins over franchiseOwnerId.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => RevenueOwnerDto)
  owners?: RevenueOwnerDto[];

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  depotId?: string | null;

  @ApiProperty({ example: 240000, description: 'Order total in whole IDR.' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  amountIdr!: number;

  @ApiPropertyOptional({
    example: 200000,
    description:
      'Goods subtotal before discount, in whole IDR — what the commission is charged on. ' +
      'Falls back to amountIdr when absent (an order-service that predates this field).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  commissionBaseIdr?: number;

  @ApiPropertyOptional({
    example: 'HM-20260728-000123',
    description: 'Shown in the ledger description.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  orderNumber?: string | null;

  @ApiPropertyOptional({ description: 'Completion timestamp; defaults to now.' })
  @IsOptional()
  @IsISO8601()
  completedAt?: string;
}

/**
 * Reversing a counter sale. No amount is accepted: what comes back is read off the original
 * ledger rows, so a commission-scheme change since the sale cannot alter what is reversed.
 */
export class VoidOrderRevenueDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  orderId!: string;

  @ApiProperty({ example: 'Pembeli salah pilih ukuran galon.' })
  @IsString()
  @MaxLength(255)
  reason!: string;
}

export class LedgerQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1, maximum: 1000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  page = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

/** PYO-2: an HQ release request and who has touched it. */
export class ReleaseRequestResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) franchiseOwnerId!: string;
  @ApiProperty({ type: String, nullable: true }) bankAccountRef!: string | null;
  @ApiProperty() amountAtRequest!: number;
  @ApiProperty({ format: 'uuid' }) requestedBy!: string;
  @ApiProperty({ enum: ['PENDING', 'APPROVED', 'REJECTED'] }) status!: string;
  @ApiProperty({ type: String, nullable: true }) decidedBy!: string | null;
  @ApiProperty({ type: Date, nullable: true }) decidedAt!: Date | null;
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
  @ApiProperty({ type: String, nullable: true }) withdrawalId!: string | null;
  @ApiProperty() createdAt!: Date;
}

/** PYO-2: why a release request was turned down (optional). */
export class RejectReleaseDto {
  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

/** PYO-3: the account a franchise owner or courier wants to be paid to. */
export class RegisterBankAccountDto {
  @ApiProperty({ example: 'BCA' })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  bankName!: string;

  @ApiProperty({ example: '1234567890', description: 'Digits only; spaces are stripped.' })
  @IsString()
  @Matches(/^[0-9 -]{6,30}$/, { message: 'accountNumber must be 6-30 digits' })
  accountNumber!: string;

  @ApiProperty({ example: 'Budi Santoso' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  accountHolder!: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description:
      'The `updatedAt` this edit started from. The write is refused (409) if the account has ' +
      'moved since — two devices replacing the same destination must not overwrite silently.',
  })
  @IsOptional()
  @IsISO8601()
  seenUpdatedAt?: string;
}

/** The account row as the reviewer saw it; pins a decision to that row. */
export class VerifyBankAccountDto {
  @ApiPropertyOptional({
    format: 'date-time',
    description:
      'The account `updatedAt` the reviewer saw. Refused (409) if the owner replaced the ' +
      'destination since, so a reviewer never verifies an account they did not see.',
  })
  @IsOptional()
  @IsISO8601()
  seenUpdatedAt?: string;
}

/** PYO-3: why HQ refused an account (optional). */
export class RejectBankAccountDto extends VerifyBankAccountDto {
  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

/** PYO-3: a registered payout destination. The number is returned only to HQ and its owner. */
export class BankAccountResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) subjectId!: string;
  @ApiProperty({ enum: ['OWNER', 'COURIER'] }) subjectType!: string;
  @ApiProperty() bankName!: string;
  @ApiProperty() accountNumber!: string;
  @ApiProperty() accountHolder!: string;
  @ApiProperty({ enum: ['PENDING', 'VERIFIED', 'REJECTED'] }) status!: string;
  @ApiProperty({ type: String, nullable: true }) verifiedBy!: string | null;
  @ApiProperty({ type: Date, nullable: true }) verifiedAt!: Date | null;
  @ApiProperty({ type: String, nullable: true }) rejectedReason!: string | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}
