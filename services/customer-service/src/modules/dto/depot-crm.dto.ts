import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { MembershipTier } from '../../domain/membership-tier.enum';

export class DepotCustomerQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Depot whose customers to list.' })
  @IsUUID()
  depotId!: string;

  @ApiPropertyOptional({ description: 'Filter by name or phone (case-insensitive).' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}

export class DepotDetailQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Depot the detail is viewed in (radius context).' })
  @IsUUID()
  depotId!: string;
}

export class DepotCustomerDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ nullable: true })
  fullName!: string | null;
  @ApiProperty({ nullable: true })
  phone!: string | null;
  @ApiProperty({ enum: MembershipTier })
  membershipTier!: MembershipTier;
  @ApiProperty({ example: 0 })
  orderCount!: number;
  @ApiProperty({ example: 0 })
  gallonsOnLoan!: number;
  @ApiProperty({ example: 0 })
  depositHeldIdr!: number;
  @ApiProperty({ nullable: true, example: null })
  lastOrderAt!: string | null;
  @ApiProperty({ example: false })
  isSubscriber!: boolean;
}

export class DepotCrmAddressDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  label!: string;
  @ApiProperty()
  recipientName!: string;
  @ApiProperty()
  phone!: string;
  @ApiProperty()
  addressLine!: string;
  @ApiProperty()
  city!: string;
  @ApiProperty()
  province!: string;
  @ApiProperty({ nullable: true })
  latitude!: number | null;
  @ApiProperty({ nullable: true })
  longitude!: number | null;
  @ApiProperty()
  isPrimary!: boolean;
  @ApiProperty({ nullable: true })
  inRadius!: boolean | null;
  @ApiProperty({ nullable: true })
  distanceKm!: number | null;
}

export class DepotDepositLedgerEntryDto {
  @ApiProperty()
  id!: string;
  @ApiProperty({ enum: ['ISSUE', 'RETURN'] })
  type!: 'ISSUE' | 'RETURN';
  @ApiProperty()
  quantity!: number;
  @ApiProperty()
  amountIdr!: number;
  @ApiProperty()
  at!: string;
}

export class DepotRecentOrderDto {
  @ApiProperty()
  id!: string;
  @ApiProperty()
  status!: string;
  @ApiProperty()
  totalIdr!: number;
  @ApiProperty()
  placedAt!: string;
}

export class DepotCustomerDetailProfileDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ nullable: true })
  fullName!: string | null;
  @ApiProperty({ nullable: true })
  phone!: string | null;
  @ApiProperty({ enum: MembershipTier })
  membershipTier!: MembershipTier;
  @ApiProperty({ example: false })
  isSubscriber!: boolean;
  @ApiProperty({ example: 0 })
  orderCount!: number;
  @ApiProperty({ example: 0 })
  totalSpentIdr!: number;
  @ApiProperty({ example: 0 })
  gallonsOnLoan!: number;
  @ApiProperty({ example: 0 })
  depositHeldIdr!: number;
  @ApiProperty({ enum: ['LOW', 'MEDIUM', 'HIGH'], nullable: true })
  churnRisk!: 'LOW' | 'MEDIUM' | 'HIGH' | null;
}

export class DepotCustomerDetailDto {
  @ApiProperty({ type: DepotCustomerDetailProfileDto })
  profile!: DepotCustomerDetailProfileDto;
  @ApiProperty({ type: [DepotCrmAddressDto] })
  addresses!: DepotCrmAddressDto[];
  @ApiProperty({ type: [DepotDepositLedgerEntryDto] })
  depositLedger!: DepotDepositLedgerEntryDto[];
  @ApiProperty({ type: [DepotRecentOrderDto] })
  recentOrders!: DepotRecentOrderDto[];
}
