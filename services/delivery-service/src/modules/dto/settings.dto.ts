import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class PutSettingDto {
  @IsIn(['GLOBAL', 'DEPOT'])
  scope!: 'GLOBAL' | 'DEPOT';

  @IsOptional()
  @IsUUID()
  depotId?: string;

  @IsString()
  @MaxLength(64)
  key!: string;

  @IsString()
  @MaxLength(128)
  value!: string;
}

export class ResetSettingDto {
  @IsIn(['GLOBAL', 'DEPOT'])
  scope!: 'GLOBAL' | 'DEPOT';

  @IsOptional()
  @IsUUID()
  depotId?: string;

  @IsString()
  @MaxLength(64)
  key!: string;
}
