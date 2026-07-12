import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

/** Self-service profile edit (name + email). Both fields optional (partial update). */
export class UpdateAccountDto {
  @ApiPropertyOptional({ description: "Customer's full name.", example: 'Budi Santoso' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fullName?: string;

  @ApiPropertyOptional({ description: 'Email address.', example: 'budi@example.com' })
  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  email?: string;
}
