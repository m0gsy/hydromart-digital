// GENERATED (audit D-6) — mirrors of the shapes these routes already return.
// Regenerate rather than hand-edit: the point is that the documented schema cannot
// drift from the response. No field is added, removed or renamed here.
import { ApiProperty } from '@nestjs/swagger';

/** Mirrors `NotificationPreferenceRecord` exactly — generated for audit D-6, no field added or removed. */
export class NotificationPreferenceResponseDto {
  @ApiProperty({ type: String })
  customerId!: string;
  @ApiProperty({ type: Boolean })
  push!: boolean;
  @ApiProperty({ type: Boolean })
  email!: boolean;
  @ApiProperty({ type: Boolean })
  whatsapp!: boolean;
  @ApiProperty({ type: Object })
  categories!: unknown;
}

/** Mirrors `Reseller` exactly — generated for audit D-6, no field added or removed. */
export class ResellerResponseDto {
  @ApiProperty({ type: String })
  customerId!: string;
  @ApiProperty({ type: String })
  homeDepotId!: string;
  @ApiProperty({ type: Number })
  monthlyTargetQty!: number;
  @ApiProperty({ type: Number })
  discountPct!: number;
  @ApiProperty({ type: Number })
  flatGallonPriceIdr!: number;
  @ApiProperty({ type: String, nullable: true })
  photoUrl!: string | null;
  @ApiProperty({ type: Boolean })
  active!: boolean;
  @ApiProperty({ type: String, format: 'date-time' })
  joinDate!: string;
  @ApiProperty({ type: String, nullable: true })
  note!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
  /** §G-3: denormalised from auth-service so the console never renders a bare UUID. */
  @ApiProperty({ type: String, nullable: true })
  customerName!: string | null;
}

/** Mirrors `AddressRecord` exactly — generated for audit D-6, no field added or removed. */
export class AddressResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  customerId!: string;
  @ApiProperty({ type: String })
  label!: string;
  @ApiProperty({ type: String })
  recipientName!: string;
  @ApiProperty({ type: String })
  phone!: string;
  @ApiProperty({ type: String })
  addressLine!: string;
  @ApiProperty({ type: String })
  city!: string;
  @ApiProperty({ type: String })
  province!: string;
  @ApiProperty({ type: String, nullable: true })
  postalCode!: string | null;
  @ApiProperty({ type: Number, nullable: true })
  latitude!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  longitude!: number | null;
  @ApiProperty({ type: String, nullable: true })
  notes!: string | null;
  @ApiProperty({ type: Boolean })
  isPrimary!: boolean;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class ListResponseDto {
  @ApiProperty({ type: [String] })
  productIds!: string[];
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class CustomerIdsByDepotResponseDto {
  @ApiProperty({ type: [String] })
  customerIds!: string[];
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class CrmDashboardCountsResponseDto {
  @ApiProperty({ type: Number })
  baru!: number;
  @ApiProperty({ type: Number })
  aktif!: number;
  @ApiProperty({ type: Number })
  inactive!: number;
  @ApiProperty({ type: Number })
  total!: number;
}

/** Mirrors `CrmFollowUp` exactly — generated for audit D-6, no field added or removed. */
export class CrmFollowUpResponseDto {
  @ApiProperty({ type: String })
  customerId!: string;
  @ApiProperty({ type: String, nullable: true })
  name!: string | null;
  @ApiProperty({ type: String, nullable: true })
  phone!: string | null;
  @ApiProperty({ type: String })
  lastOrderAt!: string;
  @ApiProperty({ type: Number })
  daysSinceLastOrder!: number;
  @ApiProperty({ type: Number })
  orderCount!: number;
  @ApiProperty({ type: Number })
  totalSpentIdr!: number;
}

/** Mirrors `CrmDashboard` exactly — generated for audit D-6, no field added or removed. */
export class CrmDashboardResponseDto {
  @ApiProperty({ type: CrmDashboardCountsResponseDto })
  counts!: CrmDashboardCountsResponseDto;
  @ApiProperty({ type: Number })
  repeatRatePct!: number;
  @ApiProperty({ type: [CrmFollowUpResponseDto] })
  followUps!: CrmFollowUpResponseDto[];
}

/** Mirrors `PaymentMethodRecord` exactly — generated for audit D-6, no field added or removed. */
export class PaymentMethodResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  customerId!: string;
  @ApiProperty({ type: Object })
  type!: unknown;
  @ApiProperty({ type: String })
  label!: string;
  @ApiProperty({ type: String, nullable: true })
  maskedIdentifier!: string | null;
  @ApiProperty({ type: Boolean })
  isDefault!: boolean;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class MeResponseDto {
  @ApiProperty({ type: Boolean })
  active!: boolean;
  @ApiProperty({ type: Number })
  discountPct!: number;
}

/** Mirrors `ImportRowResult` exactly — generated for audit D-6, no field added or removed. */
export class ImportRowResponseDto {
  @ApiProperty({ type: Number })
  row!: number;
  @ApiProperty({ type: Object })
  status!: unknown;
  @ApiProperty({ required: false, type: String })
  message?: string;
  @ApiProperty({ required: false, type: String })
  id?: string;
}

/** Mirrors `ImportSummary` exactly — generated for audit D-6, no field added or removed. */
export class ImportResponseDto {
  @ApiProperty({ type: Number })
  created!: number;
  @ApiProperty({ type: Number })
  updated!: number;
  @ApiProperty({ type: Number })
  skipped!: number;
  @ApiProperty({ type: Number })
  failed!: number;
  @ApiProperty({ type: [ImportRowResponseDto] })
  results!: ImportRowResponseDto[];
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class List2ResponseDto {
  @ApiProperty({ type: [String] })
  productIds!: string[];
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class CustomerIdsByDepot2ResponseDto {
  @ApiProperty({ type: [String] })
  customerIds!: string[];
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class Me2ResponseDto {
  @ApiProperty({ type: Boolean })
  active!: boolean;
  @ApiProperty({ type: Number })
  discountPct!: number;
  @ApiProperty({ type: Number })
  flatGallonPriceIdr!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class ClaimFavoriteDepotResponseDto {
  @ApiProperty({ type: Boolean })
  claimed!: boolean;
}

/** Mirrors the inline response shape the §I resolve-by-phone route returns. */
export class ResolveByPhoneResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  customerId!: string;
  @ApiProperty({ enum: ['created', 'pending', 'active'] })
  status!: 'created' | 'pending' | 'active';
}
