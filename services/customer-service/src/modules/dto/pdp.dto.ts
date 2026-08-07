import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

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

/**
 * §I: resolve the counter buyer by phone. `depotId` is optional so a caller with no depot
 * context can still resolve an identity without claiming the customer for a depot.
 */
export class ResolveByPhoneDto {
  @ApiProperty({ example: '+6281234567890' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phone!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fullName?: string;

  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  depotId?: string;
}
