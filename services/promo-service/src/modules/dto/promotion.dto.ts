import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreatePromotionDto {
  @ApiProperty({ example: 'Gratis ongkir pertama' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title!: string;

  @ApiPropertyOptional({ example: 'Pesanan galon pertamamu, ongkir kami tanggung.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  subtitle?: string;

  @ApiPropertyOptional({ example: 'https://cdn.hydromart.id/promo/free-ongkir.jpg' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  imageUrl?: string;

  @ApiPropertyOptional({ example: 'Pesan sekarang' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  ctaLabel?: string;

  @ApiPropertyOptional({ example: '/catalog' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  ctaHref?: string;

  @ApiPropertyOptional({ example: 'HEMAT10', description: 'Voucher code this banner promotes.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  voucherCode?: string;

  @ApiPropertyOptional({ example: 0, default: 0, description: 'Lower sorts first.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  endsAt?: string;
}

export class UpdatePromotionDto extends PartialType(CreatePromotionDto) {
  @ApiPropertyOptional({ description: 'Show or hide the promotion.' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
