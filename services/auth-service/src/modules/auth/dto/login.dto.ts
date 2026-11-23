import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

import { SOURCE_CODE_PATTERN } from './register.dto';

export class LoginDto {
  @ApiProperty({ description: 'Registered phone number.', example: '081234567890' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phone!: string;

  @ApiPropertyOptional({
    enum: ['STAFF', 'CUSTOMER'],
    description:
      'Which app is asking. STAFF (the Ops app, /hq/login, the manager phone login): a number that is not a staff login is refused instead of being signed up as a customer. CUSTOMER (the customer app): a staff login is refused and sent to the Ops app.',
  })
  @IsOptional()
  @IsIn(['STAFF', 'CUSTOMER'])
  audience?: 'STAFF' | 'CUSTOMER';

  /*
   * HD-8: a number with no account is signed up here too (AUTH-3), so this door carries the
   * same campaign codes as /register. Ignored for a number that already has an account.
   */
  @ApiPropertyOptional({
    example: 'qr-depot-bdg01',
    description: 'Campaign code of the first coded link; kept only when this signs a new number up.',
  })
  @IsOptional()
  @IsString()
  @Matches(SOURCE_CODE_PATTERN, { message: 'firstSource bukan kode sumber yang sah.' })
  firstSource?: string;

  @ApiPropertyOptional({
    example: 'meta-iklan-bandung',
    description: 'Campaign code of the latest coded link; kept only when this signs a new number up.',
  })
  @IsOptional()
  @IsString()
  @Matches(SOURCE_CODE_PATTERN, { message: 'lastSource bukan kode sumber yang sah.' })
  lastSource?: string;
}
