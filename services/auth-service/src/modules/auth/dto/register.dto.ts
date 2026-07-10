import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({
    description: 'Indonesian mobile number in local or E.164 form.',
    example: '081234567890',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phone!: string;

  @ApiPropertyOptional({ description: "Customer's full name.", example: 'Budi Santoso' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fullName?: string;

  @ApiPropertyOptional({ description: 'Optional email address.', example: 'budi@example.com' })
  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  email?: string;
}
