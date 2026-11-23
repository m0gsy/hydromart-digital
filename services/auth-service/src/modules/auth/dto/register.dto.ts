import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * HD-8: a campaign code as the web stores it (apps/web/src/lib/attribution.ts): lower case, 1
 * to 64 of a-z 0-9 . _ - and not starting with a symbol. The same pattern as depot-service's
 * /waralaba (apps/web/test/legal-versions.test.ts holds the copies together).
 */
export const SOURCE_CODE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

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

  @ApiPropertyOptional({
    description:
      'Optional marketing opt-in (UU PDP tahap 2). Omit when the form never asked — absent is recorded as "never asked", not as a refusal.',
  })
  @IsOptional()
  @IsBoolean()
  marketingConsent?: boolean;

  /*
   * HD-8: where the customer came from. Optional: most signups follow no coded link, and a
   * signup is never refused over attribution. The web only sends codes of this shape, so a
   * refusal here means a hand-made request.
   */
  @ApiPropertyOptional({
    example: 'qr-depot-bdg01',
    description: 'Campaign code of the first coded link this browser arrived by.',
  })
  @IsOptional()
  @IsString()
  @Matches(SOURCE_CODE_PATTERN, { message: 'firstSource bukan kode sumber yang sah.' })
  firstSource?: string;

  @ApiPropertyOptional({
    example: 'meta-iklan-bandung',
    description: 'Campaign code of the latest coded link this browser arrived by.',
  })
  @IsOptional()
  @IsString()
  @Matches(SOURCE_CODE_PATTERN, { message: 'lastSource bukan kode sumber yang sah.' })
  lastSource?: string;
}
