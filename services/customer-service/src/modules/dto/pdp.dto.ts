import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/** Body of the internal anonymise call (UU PDP tahap 1, item 13). */
export class PdpCustomerDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  customerId!: string;
}
