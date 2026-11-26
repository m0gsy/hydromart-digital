import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** Trim first, so three spaces are not a name. */
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class VisitTemplateItemDto {
  @ApiProperty({ example: 'Lantai dan area isi ulang bersih' })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  text!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'hr-service SOP this line points at.' })
  @IsOptional()
  @IsUUID()
  sopId?: string;
}

export class CreateVisitTemplateDto {
  @ApiProperty({ example: 'Kunjungan rutin bulanan' })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ type: [VisitTemplateItemDto], description: 'Checklist lines, in order (1-60).' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => VisitTemplateItemDto)
  items!: VisitTemplateItemDto[];
}

export class UpdateVisitTemplateDto extends CreateVisitTemplateDto {
  @ApiProperty({ description: 'false retires the template: conductors stop seeing it.' })
  @IsBoolean()
  active!: boolean;

  @ApiProperty({
    format: 'date-time',
    description:
      'CA-2-53: the `updatedAt` this edit started from. The write is refused (409) if the stored row has moved since.',
  })
  @IsISO8601()
  seenUpdatedAt!: string;
}

export class VisitTemplateConductQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'When given, each item that names a SOP carries the version in force at this depot.',
  })
  @IsOptional()
  @IsUUID()
  depotId?: string;
}

// Response shapes, declared so the OpenAPI document says what the routes return (audit D-6).
export class SopInForceResponseDto {
  @ApiProperty() sopId!: string;
  @ApiProperty() versionId!: string;
  @ApiProperty() versionNo!: number;
  @ApiProperty() title!: string;
  @ApiProperty({ description: 'A WIB day, YYYY-MM-DD.' }) effectiveFrom!: string;
}

export class VisitTemplateItemResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() position!: number;
  @ApiProperty() text!: string;
  @ApiProperty({ nullable: true }) sopId!: string | null;
  @ApiPropertyOptional({ type: SopInForceResponseDto, nullable: true })
  sopInForce?: SopInForceResponseDto | null;
}

export class VisitTemplateResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() active!: boolean;
  @ApiProperty({ nullable: true }) createdBy!: string | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
  @ApiProperty({ type: [VisitTemplateItemResponseDto] }) items!: VisitTemplateItemResponseDto[];
  @ApiPropertyOptional({ enum: ['ok', 'unavailable', 'skipped'] })
  sopLookup?: 'ok' | 'unavailable' | 'skipped';
}
