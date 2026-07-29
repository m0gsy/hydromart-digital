import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { AssetMovementKind, AssetStatus, AssetType } from '../../../prisma/generated/client';

const ASSET_TYPES: AssetType[] = [
  'MOTORCYCLE',
  'SMARTPHONE',
  'UNIFORM',
  'LAPTOP',
  'PRINTER',
  'SCANNER',
  'OTHER',
];
const ASSET_STATUSES: AssetStatus[] = ['AVAILABLE', 'ASSIGNED', 'RETURNED', 'MAINTENANCE', 'LOST'];
const MOVEMENT_KINDS: AssetMovementKind[] = ['ASSIGN', 'TRANSFER', 'RETURN', 'MAINTENANCE', 'LOST'];

/** Letters/digits/dash only — the asset tag is written on a sticker and typed back in. */
const CODE = /^[A-Za-z0-9-]+$/;

export class CreateAssetDto {
  @Matches(CODE, { message: 'code hanya boleh huruf, angka, dan tanda hubung' })
  @MaxLength(30)
  code!: string;

  @IsIn(ASSET_TYPES) type!: AssetType;
  @IsString() @MaxLength(120) name!: string;
  @IsUUID() depotId!: string;
  @IsOptional() @IsString() @MaxLength(60) brand?: string;
  @IsOptional() @IsString() @MaxLength(80) serialNo?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) value?: number;
  @IsOptional() @IsString() @MaxLength(255) note?: string;
}

export class UpdateAssetDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(60) brand?: string;
  @IsOptional() @IsString() @MaxLength(80) serialNo?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) value?: number;
  @IsOptional() @IsString() @MaxLength(255) note?: string;
}

export class MoveAssetDto {
  @IsIn(MOVEMENT_KINDS) kind!: AssetMovementKind;
  @IsOptional() @IsUUID() toEmployeeId?: string;
  @IsOptional() @IsString() @MaxLength(255) condition?: string;
  @IsOptional() @IsString() @MaxLength(255) note?: string;
}

export class ListAssetDto {
  @IsOptional() @IsUUID() depotId?: string;
  @IsOptional() @IsIn(ASSET_STATUSES) status?: AssetStatus;
  @IsOptional() @IsIn(ASSET_TYPES) type?: AssetType;
  @IsOptional() @IsUUID() holderId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}
