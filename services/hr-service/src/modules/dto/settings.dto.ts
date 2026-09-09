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
  /*
   * CA-1-41. 128 characters refused the ONE setting that exists so an accountant can load
   * PMK 168/2023 without a deploy: `pph21TerTableJson` is 4.2 KB minified. The table could
   * be read from the environment at boot and never through the screen built to edit it.
   *
   * 16 KB, not unbounded: the column is TEXT and the body limit is 1 MB, so the ceiling
   * here is about keeping a settings row a setting. The other seven services keep 128 —
   * none of their defs is a document, and this file diverging from theirs is the point.
   */
  @MaxLength(16_384)
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
