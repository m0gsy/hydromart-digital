import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsObject, IsString, ValidateNested } from 'class-validator';

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
  @ApiProperty({ description: 'The push service endpoint URL.' })
  @IsString()
  @IsNotEmpty()
  endpoint!: string;

  @ApiProperty({ type: PushKeysDto })
  @IsObject()
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys!: PushKeysDto;
}
