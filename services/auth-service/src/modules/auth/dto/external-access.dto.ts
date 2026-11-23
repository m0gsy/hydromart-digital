import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Equals, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';

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

  @ApiProperty({
    description: "Where the AI web wants the code: refused unless it is exactly the server's AI_WEB_RETURN_URL.",
  })
  @IsString()
  @MaxLength(2048)
  returnTo!: string;
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

  @ApiPropertyOptional({ description: 'HD-4: the 6-digit code from the authenticator app.' })
  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'totp must be 6 digits' })
  totp?: string;

  @ApiPropertyOptional({ description: 'HD-4: a one-time recovery code, instead of the app code.' })
  @IsOptional()
  @Matches(/^[A-Za-z2-7]{5}-?[A-Za-z2-7]{5}$/, { message: 'recoveryCode is not a recovery code' })
  recoveryCode?: string;

  @ApiPropertyOptional({ description: 'HD-4: the ticket an earlier exchange returned; no code needed while it lasts.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  secondFactorTicket?: string;
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

export class PublicJwkDto {
  @ApiProperty({ enum: ['EC'] }) kty!: 'EC';
  @ApiProperty({ enum: ['P-256'] }) crv!: 'P-256';
  @ApiProperty() x!: string;
  @ApiProperty() y!: string;
  @ApiProperty({ description: 'RFC 7638 thumbprint of the key.' }) kid!: string;
  @ApiProperty({ enum: ['sig'] }) use!: 'sig';
  @ApiProperty({ enum: ['ES256'] }) alg!: 'ES256';
}

export class JwksResponseDto {
  @ApiProperty({ type: [PublicJwkDto], description: 'Empty when AI and machine access is off.' })
  keys!: PublicJwkDto[];
}

export class HandoffCodeResponseDto {
  @ApiProperty({ description: 'One-time code, valid for expiresIn seconds.' }) code!: string;
  @ApiProperty({ example: 60 }) expiresIn!: number;
  @ApiProperty({ description: 'The AI web callback the code is for: send the browser there.' })
  returnTo!: string;
}

export class ExternalTokenResponseDto {
  @ApiProperty({ enum: ['Bearer'] }) tokenType!: 'Bearer';
  @ApiProperty({ description: 'ES256 JWT.' }) accessToken!: string;
  @ApiProperty({ example: 900 }) expiresIn!: number;
  @ApiPropertyOptional({ description: 'HD-4: after an authenticator code; send it on the next handoffs.' })
  secondFactorTicket?: string;
  @ApiPropertyOptional({ example: 43200 }) secondFactorTicketExpiresIn?: number;
}
