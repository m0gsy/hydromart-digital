import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

import { BroadcastLevel } from '../../domain/broadcast-level';
import { BroadcastForCourier, BroadcastRecord } from '../../application/ports/broadcast.repository';

/* ---------- Requests ---------- */

export class CreateBroadcastDto {
  @ApiProperty({ description: 'Depot the announcement targets (couriers assigned there see it).' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  depotId!: string;

  @ApiProperty({ example: 'Rute jalan Merdeka ditutup' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title!: string;

  @ApiProperty({ example: 'Ada perbaikan jalan sampai sore. Gunakan jalur alternatif via Sudirman.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  body!: string;

  @ApiPropertyOptional({ enum: BroadcastLevel, default: BroadcastLevel.INFO })
  @IsOptional()
  @IsEnum(BroadcastLevel)
  level?: BroadcastLevel;
}

export class BroadcastQueryDto {
  @ApiProperty({ description: 'Depot whose broadcasts to list (the courier passes their depot).' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  depotId!: string;
}

/* ---------- Responses ---------- */

export class BroadcastDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  depotId!: string;
  @ApiProperty()
  title!: string;
  @ApiProperty()
  body!: string;
  @ApiProperty({ enum: BroadcastLevel })
  level!: BroadcastLevel;
  @ApiProperty({ description: 'Depot-ops user who posted it.' })
  createdBy!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
  @ApiProperty({ description: 'True once the current courier has opened it.' })
  read!: boolean;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  readAt!: Date | null;

  static fromCourier(record: BroadcastForCourier): BroadcastDto {
    return {
      id: record.id,
      depotId: record.depotId,
      title: record.title,
      body: record.body,
      level: record.level,
      createdBy: record.createdBy,
      createdAt: record.createdAt,
      read: record.readAt !== null,
      readAt: record.readAt,
    };
  }

  /** For the create response: a freshly posted broadcast has no read receipt yet. */
  static fromRecord(record: BroadcastRecord): BroadcastDto {
    return { ...record, read: false, readAt: null };
  }
}
