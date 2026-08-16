import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { OwnershipType } from '../../domain/inventory';
import { DepotRecord } from '../../application/ports/depot.repository';

export class BrowseDepotsQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ enum: OwnershipType })
  @IsOptional()
  @IsEnum(OwnershipType)
  ownershipType?: OwnershipType;

  @ApiPropertyOptional({ description: 'Search by depot name, code, or city.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class NearbyDepotsQueryDto {
  @ApiProperty({ example: -6.1944, description: 'Caller latitude.' })
  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @ApiProperty({ example: 106.8412, description: 'Caller longitude.' })
  @Type(() => Number)
  @IsLongitude()
  lng!: number;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class CreateDepotDto {
  @ApiProperty({ example: 'JKT-01' })
  @IsString()
  @MaxLength(30)
  code!: string;

  @ApiProperty({ example: 'Depot Cikini' })
  @IsString()
  @MaxLength(150)
  name!: string;

  @ApiProperty({ enum: OwnershipType })
  @IsEnum(OwnershipType)
  ownershipType!: OwnershipType;

  @ApiProperty({ example: 'Jl. Cikini Raya No. 1' })
  @IsString()
  @MaxLength(300)
  address!: string;

  @ApiProperty({ example: 'Jakarta Pusat' })
  @IsString()
  @MaxLength(100)
  city!: string;

  @ApiProperty({ example: 'DKI Jakarta' })
  @IsString()
  @MaxLength(100)
  province!: string;

  @ApiProperty({ example: -6.1944 })
  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @ApiProperty({ example: 106.8412 })
  @Type(() => Number)
  @IsLongitude()
  lng!: number;

  @ApiPropertyOptional({ example: 5, description: 'Service/delivery radius in km.' })
  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  serviceRadiusKm?: number;

  @ApiProperty({ example: 5000, description: 'Flat delivery fee in IDR.' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  deliveryFee!: number;

  @ApiPropertyOptional({ example: 20000, description: 'Minimum order amount in IDR.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minOrderAmount?: number;

  @ApiPropertyOptional({ description: 'Franchise owner (account id) who manages this depot.' })
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({
    description:
      "Depot's own WhatsApp number for operational messages (SOP sales update). Digits " +
      'only, optionally +-prefixed — crm-service rejects anything else, and the send path ' +
      'is fail-open, so a dashed number here would mean the depot silently never gets its ' +
      'report. Same rule as SendNotificationDto.phone, stated where it is typed.',
    example: '081234567890',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9]{8,15}$/, {
    message: 'contactPhone must be 8-15 digits, optionally prefixed with +',
  })
  @MaxLength(20)
  contactPhone?: string;

  @ApiPropertyOptional({ description: "Depot's bank name for direct payment.", example: 'BCA' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  paymentBankName?: string;

  @ApiPropertyOptional({ description: "Depot's bank account number.", example: '1234567890' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  paymentBankAccountNumber?: string;

  @ApiPropertyOptional({ description: "Depot's bank account holder name." })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  paymentBankAccountHolder?: string;

  @ApiPropertyOptional({ description: "URL of the depot's static QRIS image." })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  paymentQrisImageUrl?: string;

  // ponytail: JSON blobs validated shallowly (shape documented in schema.prisma); tighten to
  // nested DTOs if operators start submitting malformed hours/holidays.
  @ApiPropertyOptional({
    description:
      'Weekly hours, e.g. { "mon": { "open": "08:00", "close": "21:00", ' +
      '"breakStart": "12:00", "breakEnd": "13:00" } }. The break is optional per day — ' +
      'Friday simply carries an earlier breakStart, no special field.',
  })
  @IsOptional()
  @IsObject()
  operatingHours?: Record<
    string,
    { open: string; close: string; breakStart?: string; breakEnd?: string }
  >;

  @ApiPropertyOptional({ description: 'Closure dates, e.g. [{ "date": "2026-08-17" }].' })
  @IsOptional()
  @IsArray()
  holidays?: { date: string; label?: string }[];
}

export class UpdateDepotDto extends PartialType(CreateDepotDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/* ---------- Public projection ---------- */

/**
 * What an UNAUTHENTICATED caller may see about a depot: enough to browse, locate and
 * price a delivery, and nothing else.
 *
 * The full `DepotRecord` used to be served straight off the public browse/detail
 * routes, which published every depot's bank name, account number and account holder
 * to anyone who asked — scrapeable in bulk and ideal material for "transfer to this
 * account" fraud using a real depot's details. Payment destinations now live behind
 * `GET /depots/:id/payment-info` (any signed-in user, one depot at a time) and the
 * ownership/audit fields behind the staff route `GET /depots/manage/:id`.
 */
export class PublicDepotView {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() address!: string;
  @ApiProperty() city!: string;
  @ApiProperty() province!: string;
  @ApiProperty() lat!: number;
  @ApiProperty() lng!: number;
  @ApiProperty() serviceRadiusKm!: number;
  @ApiProperty() deliveryFee!: number;
  @ApiProperty({ nullable: true }) minOrderAmount!: number | null;
  @ApiProperty() operatingHours!: unknown;
  @ApiProperty({ type: [Object] }) holidays!: unknown[];
  @ApiProperty() active!: boolean;

  static from(d: DepotRecord): PublicDepotView {
    return {
      id: d.id,
      code: d.code,
      name: d.name,
      address: d.address,
      city: d.city,
      province: d.province,
      lat: d.lat,
      lng: d.lng,
      serviceRadiusKm: d.serviceRadiusKm,
      deliveryFee: d.deliveryFee,
      minOrderAmount: d.minOrderAmount,
      operatingHours: d.operatingHours,
      holidays: d.holidays,
      active: d.active,
    };
  }
}

/**
 * The public projection plus the distance annotation, for `GET /depots/nearby`.
 *
 * That route was returning the whole `DepotRecord` — every depot's bank name, account
 * number and account holder, on an anonymous endpoint, which is the exact leak
 * `PublicDepotView` was introduced to close on `browse` next door. Same fix, same shape.
 */
export class NearbyDepotView extends PublicDepotView {
  @ApiProperty() distanceKm!: number;
  @ApiProperty() withinService!: boolean;

  static fromNearby(d: DepotRecord & { distanceKm: number; withinService: boolean }): NearbyDepotView {
    return { ...PublicDepotView.from(d), distanceKm: d.distanceKm, withinService: d.withinService };
  }
}

/** Where to send money for ONE depot. Signed-in callers only. */
/**
 * One depot's own phone number, for the customer help screen.
 *
 * `contactPhone` is off `PublicDepotView` on purpose (see the anti-harvest note on
 * `internal/contacts`): anonymous and in bulk, it is a scrapeable directory of every
 * depot's line. One depot at a time, to a signed-in caller, is the same trade the bank
 * details already make in `DepotPaymentInfoView` — so it gets the same guard, not a
 * looser one. `name` rides along because the help card says "hubungi <nama depot>".
 */
export class DepotContactView {
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true }) contactPhone!: string | null;

  static from(d: DepotRecord): DepotContactView {
    return { name: d.name, contactPhone: d.contactPhone };
  }
}

export class DepotPaymentInfoView {
  /** Public anyway, and the payment panel reads "transfer masuk ke <nama depot>" — carrying
   *  it here saves the page a second fetch just to render the sentence. */
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true }) paymentBankName!: string | null;
  @ApiProperty({ nullable: true }) paymentBankAccountNumber!: string | null;
  @ApiProperty({ nullable: true }) paymentBankAccountHolder!: string | null;
  @ApiProperty({ nullable: true }) paymentQrisImageUrl!: string | null;

  static from(d: DepotRecord): DepotPaymentInfoView {
    return {
      name: d.name,
      paymentBankName: d.paymentBankName,
      paymentBankAccountNumber: d.paymentBankAccountNumber,
      paymentBankAccountHolder: d.paymentBankAccountHolder,
      paymentQrisImageUrl: d.paymentQrisImageUrl,
    };
  }
}
