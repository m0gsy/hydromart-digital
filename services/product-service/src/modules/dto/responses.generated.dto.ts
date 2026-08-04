// GENERATED (audit D-6) — mirrors of the shapes these routes already return.
// Regenerate rather than hand-edit: the point is that the documented schema cannot
// drift from the response. No field is added, removed or renamed here.
import { ApiProperty } from '@nestjs/swagger';

/** Mirrors `CategoryRecord` exactly — generated for audit D-6, no field added or removed. */
export class CategoryResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String })
  slug!: string;
  @ApiProperty({ type: Number })
  sortOrder!: number;
  @ApiProperty({ type: Boolean })
  active!: boolean;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Mirrors `ProductRecord` exactly — generated for audit D-6, no field added or removed. */
export class ProductResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String, nullable: true })
  categoryId!: string | null;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String })
  sku!: string;
  @ApiProperty({ type: String, nullable: true })
  description!: string | null;
  @ApiProperty({ type: String })
  unit!: string;
  @ApiProperty({ type: Number, nullable: true })
  volumeMl!: number | null;
  @ApiProperty({ type: Boolean })
  isGallon!: boolean;
  @ApiProperty({ type: Number })
  basePrice!: number;
  @ApiProperty({ type: String, nullable: true })
  imageUrl!: string | null;
  @ApiProperty({ type: [String] })
  images!: string[];
  @ApiProperty({ type: Boolean })
  active!: boolean;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class UploadResponseDto {
  @ApiProperty({ type: String })
  url!: string;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class Upload2ResponseDto {
  @ApiProperty({ type: String })
  url!: string;
}

/** Mirrors `Page<ProductRecord>` — the paged envelope this route already returns. */
export class PagedProductResponseDto {
  @ApiProperty({ type: [ProductResponseDto] })
  items!: ProductResponseDto[];
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: Number })
  page!: number;
  @ApiProperty({ type: Number })
  limit!: number;
  @ApiProperty({ type: Number })
  totalPages!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class Upload3ResponseDto {
  @ApiProperty({ type: String })
  url!: string;
}
