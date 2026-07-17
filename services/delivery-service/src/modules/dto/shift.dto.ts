import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsLatitude, IsLongitude, IsOptional, IsUUID } from 'class-validator';

import { ShiftStatus } from '../../domain/shift';

export class CheckInDto {
  @ApiProperty({ format: 'uuid', description: 'Depot the courier is checking in at.' })
  @IsUUID()
  depotId!: string;

  @ApiProperty({ example: -6.9147, description: "Courier's current latitude." })
  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @ApiProperty({ example: 107.6098, description: "Courier's current longitude." })
  @Type(() => Number)
  @IsLongitude()
  lng!: number;
}

export class CheckOutDto {
  @ApiProperty({ example: -6.9147 })
  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @ApiProperty({ example: 107.6098 })
  @Type(() => Number)
  @IsLongitude()
  lng!: number;
}

export class SetShiftStatusDto {
  @ApiProperty({
    enum: [ShiftStatus.ONLINE, ShiftStatus.BREAK, ShiftStatus.OFFLINE],
    description: 'ENDED is reached by checking out, not by setting status.',
  })
  @IsEnum(ShiftStatus)
  status!: ShiftStatus;
}

export class ListShiftsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  depotId?: string;

  @ApiPropertyOptional({ example: '2026-07-17T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-07-17T23:59:59.999Z' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
