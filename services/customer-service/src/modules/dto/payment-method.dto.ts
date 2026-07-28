import { ApiProperty, ApiPropertyOptional, PartialType, PickType } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

const PAYMENT_TYPES = ['CASH', 'TRANSFER', 'QRIS', 'EWALLET', 'VA'] as const;

export class CreatePaymentMethodDto {
  @ApiProperty({ enum: PAYMENT_TYPES, example: 'EWALLET' })
  // @IsIn, not @IsEnum: PAYMENT_TYPES is a const ARRAY, whose only keys are numeric
  // indices — @IsEnum builds its message from the key names and so rendered the allowed
  // list as blank ("type must be one of the following values: "), leaving the caller
  // nothing to correct.
  @IsIn(PAYMENT_TYPES)
  type!: (typeof PAYMENT_TYPES)[number];

  @ApiProperty({ example: 'GoPay' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  label!: string;

  @ApiPropertyOptional({ example: '••••4821' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  maskedIdentifier?: string;

  @ApiPropertyOptional({ description: 'Make this the default method.', example: true })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

/** Patch: type/label/masked only. Default is changed via the dedicated endpoint. */
export class UpdatePaymentMethodDto extends PartialType(
  PickType(CreatePaymentMethodDto, ['type', 'label', 'maskedIdentifier'] as const),
) {}
