import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

import { OtpChallengeResponseDto } from './responses.dto';

export class TotpConfirmDto {
  @ApiProperty({ description: 'The 6-digit code the authenticator app shows now.' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code!: string;

  @ApiProperty({ description: 'The code the SMS to the account number carried.' })
  @IsString()
  @Matches(/^[0-9]{4,8}$/, { message: 'smsCode must be the digits from the SMS' })
  smsCode!: string;
}

export class TotpStatusDto {
  @ApiProperty({ description: 'False while the server has no TOTP_ENCRYPTION_KEY.' }) available!: boolean;
  @ApiProperty({ description: 'This role must pass the step to sign in to the AI web.' }) required!: boolean;
  @ApiProperty() enrolled!: boolean;
  @ApiProperty() recoveryCodesLeft!: number;
  @ApiProperty({ type: String, nullable: true, description: 'ISO time, while locked.' })
  lockedUntil!: string | null;
}

export class TotpEnrolmentDto {
  @ApiProperty({ description: 'Base32 secret, for typing into the app by hand.' }) secret!: string;
  @ApiProperty({ description: 'otpauth:// link, for a QR code.' }) otpauthUri!: string;
  @ApiProperty({ type: OtpChallengeResponseDto, description: 'Where the SMS code went.' })
  sms!: OtpChallengeResponseDto;
}

export class TotpRecoveryCodesDto {
  @ApiProperty({ type: [String], description: 'Ten one-time codes. Shown once, never again.' })
  recoveryCodes!: string[];
}

export class TotpResetDto {
  @ApiProperty({ description: 'False when the account had no authenticator.' }) removed!: boolean;
}
