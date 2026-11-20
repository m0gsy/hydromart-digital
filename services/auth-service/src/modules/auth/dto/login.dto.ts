import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

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
}
