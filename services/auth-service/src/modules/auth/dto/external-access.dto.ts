import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsString, IsUUID, Length, Matches } from 'class-validator';

/** RFC 7636: a verifier is 43-128 unreserved characters; an S256 challenge is 43. */
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/;

export class HandoffCodeDto {
  @ApiProperty({ description: 'BASE64URL(SHA-256(code_verifier)), from the AI web.' })
  @IsString()
  @Matches(BASE64URL_43, { message: 'codeChallenge must be an S256 PKCE challenge' })
  codeChallenge!: string;

  @ApiProperty({ enum: ['S256'], description: 'Only S256; the plain method is refused.' })
  @Equals('S256')
  codeChallengeMethod!: 'S256';
}

export class HandoffTokenDto {
  @ApiProperty({ description: 'The one-time code the handoff returned.' })
  @IsString()
  @Matches(BASE64URL_43, { message: 'code is not a handoff code' })
  code!: string;

  @ApiProperty({ description: 'The PKCE verifier the challenge was made from.' })
  @IsString()
  @Matches(VERIFIER, { message: 'codeVerifier must be 43-128 PKCE characters' })
  codeVerifier!: string;
}

export class MachineTokenDto {
  @ApiProperty({ description: 'The machine account id (a UUID).' })
  @IsUUID()
  accountId!: string;

  @ApiProperty({ description: 'The machine account secret.' })
  @IsString()
  @Length(32, 256)
  secret!: string;
}
