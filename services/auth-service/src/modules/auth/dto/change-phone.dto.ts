import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * K1.4, step one. The number the caller wants to move to; the code goes there.
 *
 * Format is checked again in the domain (`PhoneNumber.create`), which is the canonical
 * form the whole system stores. This layer only refuses the obviously-not-a-number so a
 * typo comes back as a 400 with a field name rather than as a domain error.
 */
export class RequestPhoneChangeDto {
  @ApiProperty({ description: 'The new phone number, Indonesian format.', example: '081234567890' })
  @IsString()
  @MinLength(8)
  @MaxLength(20)
  @Matches(/^[0-9+\-\s()]+$/, { message: 'phone must contain digits only' })
  phone!: string;
}

/**
 * K1.4, step two. The code only — the DESTINATION is read off the stored challenge.
 *
 * Deliberately not `{ phone, code }`. A code proves control of wherever it was delivered,
 * so accepting a number here would let one proof move the account onto a different one.
 * The global pipe runs `forbidNonWhitelisted`, so a client that sends `phone` anyway gets
 * a 400 instead of a field that is quietly ignored.
 */
export class ConfirmPhoneChangeDto {
  @ApiProperty({ description: 'The code sent to the new number.', example: '123456' })
  @IsString()
  @Length(4, 8)
  code!: string;
}
