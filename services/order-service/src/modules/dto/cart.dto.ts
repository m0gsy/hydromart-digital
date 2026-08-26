import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsPositive, IsUUID, Max } from 'class-validator';

export class AddCartItemDto {
  @ApiProperty({ format: 'uuid', description: 'Catalog product id.' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ example: 2, minimum: 1, maximum: 999, description: 'Quantity to add.' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @Max(999)
  quantity!: number;
}

export class SetCartItemQuantityDto {
  @ApiProperty({ example: 3, minimum: 1, maximum: 999, description: 'New absolute quantity.' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @Max(999)
  quantity!: number;
}

/**
 * PG-03 — the shelf price of one product at one depot.
 *
 * `basis` is the honest half: `DEPOT` means this IS what the depot charges (the same
 * `priceLines` the cart is billed through produced it); `CATALOG` means nobody could tell us
 * the depot's price, so the caller must label what it shows instead of passing it off.
 */
export class ShelfPriceDto {
  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty({ example: 22_000, description: 'Unit price in integer IDR.' })
  unitPrice!: number;
}

export class ShelfPricesResponseDto {
  @ApiProperty({ enum: ['DEPOT', 'CATALOG'] })
  basis!: string;

  @ApiProperty({ type: [ShelfPriceDto] })
  prices!: ShelfPriceDto[];
}
