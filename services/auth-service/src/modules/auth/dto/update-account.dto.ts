import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

/** Self-service profile edit (name + email). Both fields optional (partial update). */
export class UpdateAccountDto {
  @ApiPropertyOptional({ description: "Customer's full name.", example: 'Budi Santoso' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fullName?: string;

  /**
   * CA-3-49: `null` REMOVES the address; absent leaves it alone.
   *
   * The runtime has always accepted both — `@IsOptional()` skips `@IsEmail()` for null,
   * `updateProfile` treats undefined as "no opinion", and the column is nullable. The
   * declared type said `string`, which is the thing that invites someone to "tighten" the
   * contract and rebuild the wall this row exists to remove.
   */
  @ApiPropertyOptional({
    description: 'Email address. Send null to remove it; omit to leave it unchanged.',
    example: 'budi@example.com',
    nullable: true,
  })
  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  email?: string | null;
}
