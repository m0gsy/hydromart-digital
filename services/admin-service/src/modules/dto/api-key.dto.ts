import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { ApiKeyEnvironment } from '../../domain/api-key-environment';
import { ApiKeyRecord } from '../../application/ports/api-key.repository';
import { ApiKeyWithSecret } from '../../application/services/api-key.service';

/* ---------- Requests ---------- */

export class CreateApiKeyDto {
  @ApiProperty({ example: 'Payment gateway' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ type: [String], example: ['payments:read', 'payments:write'] })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  scopes!: string[];

  @ApiPropertyOptional({ enum: ApiKeyEnvironment, default: ApiKeyEnvironment.PROD })
  @IsOptional()
  @IsEnum(ApiKeyEnvironment)
  environment?: ApiKeyEnvironment;
}

/* ---------- Responses ---------- */

export class ApiKeyDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ example: 'Payment gateway' })
  name!: string;
  @ApiProperty({ example: 'hm_live_a1b2c3d4' })
  keyPrefix!: string;
  @ApiProperty({ type: [String], example: ['payments:read'] })
  scopes!: string[];
  @ApiProperty({ enum: ApiKeyEnvironment })
  environment!: ApiKeyEnvironment;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastUsedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  revokedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  static from(record: ApiKeyRecord): ApiKeyDto {
    return {
      id: record.id,
      name: record.name,
      keyPrefix: record.keyPrefix,
      scopes: record.scopes,
      environment: record.environment,
      lastUsedAt: record.lastUsedAt ? record.lastUsedAt.toISOString() : null,
      revokedAt: record.revokedAt ? record.revokedAt.toISOString() : null,
      createdAt: record.createdAt.toISOString(),
    };
  }
}

/** Create/rotate response — carries the full secret exactly ONCE. */
export class CreatedApiKeyDto extends ApiKeyDto {
  @ApiProperty({ description: 'The full secret — shown once, store it now.', example: 'hm_live_…' })
  token!: string;

  static fromSecret(result: ApiKeyWithSecret): CreatedApiKeyDto {
    return { ...ApiKeyDto.from(result.record), token: result.token };
  }
}
