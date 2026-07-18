import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

import { AuditLogListItem } from '../../../application/ports/audit-log.repository';
import { AUDIT_CATEGORIES } from '../../../application/services/audit.service';

const AUDIT_CATEGORY_KEYS = Object.keys(AUDIT_CATEGORIES);

export class AuditQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({ description: 'Exact action filter (e.g. depot.suspend).' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  action?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Filter to a single actor.' })
  @IsOptional()
  @IsUUID()
  actorId?: string;
}

/** Depot-scoped audit list (design 8b). depotId is required; type is a category chip. */
export class DepotAuditQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Depot to scope the trail to.' })
  @IsUUID()
  depotId!: string;

  @ApiPropertyOptional({ enum: AUDIT_CATEGORY_KEYS, description: 'Category chip filter.' })
  @IsOptional()
  @IsIn(AUDIT_CATEGORY_KEYS)
  type?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

/** Cross-service audit event posted by another service (internal auth). */
export class IngestAuditDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Acting account id (null for system events).' })
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiProperty({ example: 'depot.suspend', description: 'Dotted action name.' })
  @IsString()
  @MaxLength(120)
  action!: string;

  @ApiPropertyOptional({ example: 'Depot Kelapa Gading', description: 'Human-readable target.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  target?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  success?: boolean;

  @ApiPropertyOptional({ description: 'Non-sensitive structured context (e.g. a before/after diff).' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class AuditLogDto {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true }) actorId!: string | null;
  @ApiProperty({ nullable: true }) actorName!: string | null;
  @ApiProperty({ nullable: true }) actorEmail!: string | null;
  @ApiProperty({ nullable: true }) actorRole!: string | null;
  @ApiProperty() action!: string;
  @ApiProperty({ nullable: true }) target!: string | null;
  @ApiProperty() success!: boolean;
  @ApiProperty({ nullable: true, type: Object }) metadata!: Record<string, unknown> | null;
  @ApiProperty() createdAt!: string;

  static from(item: AuditLogListItem): AuditLogDto {
    const target =
      item.metadata && typeof item.metadata.target === 'string' ? item.metadata.target : null;
    return {
      id: item.id,
      actorId: item.customerId,
      actorName: item.actorName,
      actorEmail: item.actorEmail,
      actorRole: item.actorRole,
      action: item.action,
      target,
      success: item.success,
      metadata: item.metadata,
      createdAt: item.createdAt.toISOString(),
    };
  }
}
