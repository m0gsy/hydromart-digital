import { IsBoolean, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

/** Letters/digits/dash only — the code is typed into the bulk-import spreadsheet. */
const CODE = /^[A-Za-z0-9-]+$/;

export class CreateDepartmentDto {
  @Matches(CODE, { message: 'code hanya boleh huruf, angka, dan tanda hubung' })
  @MaxLength(20)
  code!: string;

  @IsString() @MaxLength(80) name!: string;
  @IsOptional() @IsUUID() depotId?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateDepartmentDto {
  @IsOptional() @Matches(CODE) @MaxLength(20) code?: string;
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsUUID() depotId?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class ListDepartmentDto {
  @IsOptional() @IsUUID() depotId?: string;
}
