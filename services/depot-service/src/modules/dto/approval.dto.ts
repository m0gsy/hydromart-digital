import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

import { ApprovalPayload, ApprovalStatus, ApprovalType } from '../../domain/approval';
import { ApprovalDecision } from '../../application/services/approval.service';

export class CreateApprovalDto {
  @ApiProperty({ format: 'uuid', description: 'Depot the item belongs to.' })
  @IsUUID()
  depotId!: string;

  @ApiProperty({ enum: ApprovalType })
  @IsEnum(ApprovalType)
  type!: ApprovalType;

  @ApiProperty({ example: 'Selisih stok galon 19L' })
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title!: string;

  @ApiPropertyOptional({ example: 'Galon 19L', description: 'Product/customer/courier name.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  subjectRef?: string;

  @ApiProperty({ example: -240000, description: 'Signed rupiah at stake (loss/refund/shortfall).' })
  @IsInt()
  amountIdr!: number;

  @ApiPropertyOptional({ description: 'Snapshot for the detail view (system/physical/variance, etc).' })
  @IsOptional()
  @IsObject()
  payload?: ApprovalPayload;
}

export class ListApprovalQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Depot to list items for.' })
  @IsUUID()
  depotId!: string;

  @ApiPropertyOptional({ enum: ApprovalStatus })
  @IsOptional()
  @IsEnum(ApprovalStatus)
  status?: ApprovalStatus;
}

export class CountsApprovalQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Depot to count pending items for.' })
  @IsUUID()
  depotId!: string;
}

export class DecideApprovalDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT', 'HOLD'] })
  @IsEnum({ APPROVE: 'APPROVE', REJECT: 'REJECT', HOLD: 'HOLD' })
  decision!: ApprovalDecision;

  @ApiPropertyOptional({ example: 'Selisih wajar, disetujui' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
