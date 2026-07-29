import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsISO8601, IsOptional, IsUUID } from 'class-validator';

import { EmployeeDocumentType } from '../../../prisma/generated/client';

export class UploadDocumentDto {
  @IsUUID() employeeId!: string;

  @ApiProperty({ enum: EmployeeDocumentType })
  @IsEnum(EmployeeDocumentType)
  type!: EmployeeDocumentType;

  /** Contract end date / ID expiry. Omit for a document that does not expire. */
  @IsOptional() @IsISO8601() expiresAt?: string;
}

export class ListDocumentDto {
  @IsUUID() employeeId!: string;
}
