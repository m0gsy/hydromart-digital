import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';

export class PushKeysDto {
  @ApiProperty({ description: 'Client public key (base64url), from PushSubscription.keys.p256dh.' })
  @IsString()
  @IsNotEmpty()
  p256dh!: string;

  @ApiProperty({ description: 'Auth secret (base64url), from PushSubscription.keys.auth.' })
  @IsString()
  @IsNotEmpty()
  auth!: string;
}

export class SubscribePushDto {
  @ApiProperty({
    description:
      'The push service endpoint URL, or `fcm:<token>` for an Android device (F4). Validated as a string, not a URL, precisely so the FCM form fits.',
  })
  @IsString()
  @IsNotEmpty()
  endpoint!: string;

  @ApiPropertyOptional({
    type: PushKeysDto,
    description:
      'Web Push encryption keys. Absent for FCM: an Android registration has no keypair — Google encrypts the transport itself.',
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys?: PushKeysDto;
}
