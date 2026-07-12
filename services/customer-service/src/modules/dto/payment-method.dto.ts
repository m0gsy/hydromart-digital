import { ApiProperty, ApiPropertyOptional, PartialType, PickType } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

const PAYMENT_TYPES = ['CASH', 'TRANSFER', 'QRIS', 'EWALLET', 'VA'] as const;

export class CreatePaymentMethodDto {
  @ApiProperty({ enum: PAYMENT_TYPES, example: 'EWALLET' })
  @IsEnum(PAYMENT_TYPES)
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
