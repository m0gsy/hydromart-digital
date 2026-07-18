import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AddFavoriteDto {
  @ApiProperty({ example: 'prod-galon-19l', description: 'Product id to favorite.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  productId!: string;
}
