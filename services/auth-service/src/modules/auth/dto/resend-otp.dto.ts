import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';

import { OtpPurpose } from '../../../domain/otp/otp-purpose.enum';

export class ResendOtpDto {
  @ApiProperty({ description: 'Registered phone number.', example: '081234567890' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phone!: string;

  @ApiProperty({ enum: OtpPurpose, description: 'The flow the code is for.' })
  @IsEnum(OtpPurpose)
  purpose!: OtpPurpose;
}
