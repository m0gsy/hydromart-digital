import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/** Body of the internal anonymise call (UU PDP tahap 1, item 13). */
export class PdpCustomerDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  customerId!: string;
}

/**
 * order-service reporting where a customer just bought water, so a self-registered
 * customer appears in that depot's directory (§I). Not a "set my favourite depot": the
 * service only writes it when there is none.
 */
export class ClaimFavoriteDepotDto {
  @IsUUID()
  customerId!: string;

  @IsUUID()
  depotId!: string;
}
