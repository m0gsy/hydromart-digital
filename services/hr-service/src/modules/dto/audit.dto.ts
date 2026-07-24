import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class ListAuditDto {
  @IsOptional() @IsString() @MaxLength(64) entity?: string;
  @IsOptional() @IsUUID() entityId?: string;
  @IsOptional() @IsUUID() actorId?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize = 50;
}
