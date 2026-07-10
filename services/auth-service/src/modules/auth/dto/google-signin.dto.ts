import { ApiProperty } from '@nestjs/swagger';
import { IsJWT, IsNotEmpty, IsString } from 'class-validator';

export class GoogleSignInDto {
  @ApiProperty({ description: 'Google ID token obtained from the client SDK.' })
  @IsString()
  @IsNotEmpty()
  @IsJWT()
  idToken!: string;
}
