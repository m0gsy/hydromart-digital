import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { HandoverItemState } from '../../domain/handover';

export class HandoverItemDto {
  @ApiProperty({ example: 'Setoran kas' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiProperty({ example: 'Rp 1.240.000 diserahkan ke brankas' })
  @IsString()
  @MaxLength(500)
  subtext!: string;

  @ApiProperty({ enum: HandoverItemState })
  @IsEnum(HandoverItemState)
  state!: HandoverItemState;
}

export class CreateHandoverDto {
  @ApiProperty({ format: 'uuid', description: 'Depot being handed over.' })
  @IsUUID()
  depotId!: string;

  @ApiProperty({ example: 'Pagi' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  fromShift!: string;

  @ApiProperty({ example: 'Sore' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  toShift!: string;

  @ApiProperty({ example: 'Budi' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  fromStaff!: string;

  @ApiProperty({ example: 'Sari' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  toStaff!: string;

  @ApiProperty({ type: [HandoverItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HandoverItemDto)
  items!: HandoverItemDto[];

  @ApiPropertyOptional({ example: 'Galon kosong belum dihitung ulang' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ListHandoverQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Depot to list handovers for.' })
  @IsUUID()
  depotId!: string;
}
