import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Query for the staff phone lookup. Normalization to E.164 happens in the service. */
export class CustomerLookupDto {
  @ApiProperty({
    description: 'Customer phone in local or E.164 form.',
    example: '081234567890',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phone!: string;
}
