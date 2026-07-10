import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsString, Length, Matches, MaxLength } from 'class-validator';

import { OtpPurpose } from '../../../domain/otp/otp-purpose.enum';

export class VerifyOtpDto {
  @ApiProperty({ description: 'Registered phone number.', example: '081234567890' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phone!: string;

  @ApiProperty({ description: 'The numeric OTP code sent to the phone.', example: '123456' })
  @IsString()
  @Length(4, 8)
  @Matches(/^\d+$/, { message: 'code must contain digits only' })
  code!: string;

  @ApiProperty({ enum: OtpPurpose, description: 'Whether this verifies registration or login.' })
  @IsEnum(OtpPurpose)
  purpose!: OtpPurpose;
}
