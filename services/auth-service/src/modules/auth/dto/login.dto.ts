import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ description: 'Registered phone number.', example: '081234567890' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phone!: string;

  @ApiPropertyOptional({
    enum: ['STAFF'],
    description:
      'Sent by the staff-only doors (the Ops app, /hq/login, the manager phone login): a number that is not a staff login is refused instead of being signed up as a customer.',
  })
  @IsOptional()
  @IsIn(['STAFF'])
  audience?: 'STAFF';
}
