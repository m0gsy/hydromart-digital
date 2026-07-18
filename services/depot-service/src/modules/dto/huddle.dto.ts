import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** ISO date of the week's Monday, e.g. "2026-07-14". */
const WEEK_START = /^\d{4}-\d{2}-\d{2}$/;

export class HuddleAgendaItemDto {
  @ApiProperty({ example: 'Stok galon menipis' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiProperty({ example: 'Pesan tambahan ke supplier utama' })
  @IsString()
  @MaxLength(1000)
  note!: string;
}

export class HuddleActionItemDto {
  @ApiProperty({ example: 'Hubungi supplier Tirta Makmur' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  text!: string;

  @ApiProperty({ example: 'Budi' })
  @IsString()
  @MaxLength(120)
  assignee!: string;

  @ApiProperty({ example: false })
  @IsBoolean()
  done!: boolean;
}

export class UpsertHuddleNoteDto {
  @ApiProperty({ format: 'uuid', description: 'Depot the huddle was held at.' })
  @IsUUID()
  depotId!: string;

  @ApiProperty({ example: '2026-07-14', description: "ISO date of the week's Monday." })
  @IsString()
  @Matches(WEEK_START, { message: 'weekStart must be a YYYY-MM-DD date.' })
  weekStart!: string;

  @ApiPropertyOptional({ example: '8 dari 9 hadir' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  attendance?: string;

  @ApiProperty({ type: [HuddleAgendaItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HuddleAgendaItemDto)
  agenda!: HuddleAgendaItemDto[];

  @ApiProperty({ type: [HuddleActionItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HuddleActionItemDto)
  actionItems!: HuddleActionItemDto[];
}

export class ListHuddleQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Depot to list huddle notes for.' })
  @IsUUID()
  depotId!: string;

  @ApiPropertyOptional({
    example: '2026-07-14',
    description: 'If given, returns the single note for that week (or null).',
  })
  @IsOptional()
  @IsString()
  @Matches(WEEK_START, { message: 'weekStart must be a YYYY-MM-DD date.' })
  weekStart?: string;
}
