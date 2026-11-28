import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** Walk-in only: a cashier code links the number to nobody; only the customer's own in-app code links an account. */
export class CreateCashierCodeDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  depotId!: string;
}

export class ContactStateDto {
  @ApiProperty({ type: [String], format: 'uuid', maxItems: 200 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  customerIds!: string[];
}

export class SetWaCapDto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  monthlyMessages!: number;

  @ApiPropertyOptional({ nullable: true, description: 'Estimated rate in Rp per message, from Meta\'s official price list. Null = not filled in.' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  rateIdr?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Monthly cost cap in Rp; enforced only when a rate is set.' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  monthlyCostIdr?: number | null;
}

export class PauseWaDto {
  @ApiProperty()
  @IsBoolean()
  paused!: boolean;
}

export class SetWaTemplateStatusDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 'id' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  language!: string;

  @ApiProperty({ enum: ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAUSED'] })
  @IsString()
  status!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class OptOutsQueryDto {
  @ApiPropertyOptional({ default: 0, description: 'Rows with a seq above this. Re-read an overlap window (see the contract).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  after?: number;

  @ApiPropertyOptional({ default: 500, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class OptOutItemDto {
  @ApiProperty({ description: 'The AI web\'s own id for this event (`wa2:<seq>`); the replay key.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  eventId!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(32)
  phone!: string;

  @ApiProperty({ enum: ['MARKETING'] })
  @IsIn(['MARKETING'])
  purpose!: 'MARKETING';

  @ApiProperty()
  @IsBoolean()
  granted!: boolean;

  @ApiProperty({ format: 'date-time' })
  @IsISO8601()
  recordedAt!: string;
}

export class OptOutsDto {
  @ApiProperty({ type: [OptOutItemDto], maxItems: 200 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => OptOutItemDto)
  items!: OptOutItemDto[];
}
