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
