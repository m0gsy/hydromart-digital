import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { FranchiseApplicationRecord } from '../../application/ports/franchise-application.repository';
import {
  Checklist,
  ChecklistItemStatus,
  FranchiseAppStage,
} from '../../domain/franchise-application';

export class ListApplicationsQueryDto {
  @ApiPropertyOptional({ default: 1, maximum: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ enum: FranchiseAppStage, description: 'Filter by pipeline stage.' })
  @IsOptional()
  @IsEnum(FranchiseAppStage)
  stage?: FranchiseAppStage;
}

// Non-terminal stages only — APPROVED/REJECTED go through the approve/reject actions.
const EDITABLE_STAGES = [
  FranchiseAppStage.PENDING,
  FranchiseAppStage.DOC_VERIFICATION,
  FranchiseAppStage.SURVEY,
] as const;

export class PatchApplicationDto {
  @ApiPropertyOptional({ enum: EDITABLE_STAGES })
  @IsOptional()
  @IsEnum(FranchiseAppStage)
  stage?: FranchiseAppStage;

  @ApiPropertyOptional({
    description: 'Checklist map { ktpNpwp, locationProof, capitalDeposit, fieldSurvey } → status.',
    example: { ktpNpwp: ChecklistItemStatus.VERIFIED, fieldSurvey: ChecklistItemStatus.PENDING },
  })
  @IsOptional()
  @IsObject()
  checklist?: Partial<Checklist>;
}

/**
 * A prospective partner's own submission — the only franchise-application route that is
 * public. Deliberately narrower than CreateFranchiseApplicationData: an applicant states
 * who they are, where they want to open and what they intend to invest. `stage` and
 * `checklist` are NOT accepted; the server starts every application at PENDING with an
 * all-PENDING checklist so nobody can submit themselves pre-verified.
 */
export class SubmitFranchiseApplicationDto {
  @ApiProperty({ example: 'Budi Santoso' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  applicantName!: string;

  @ApiProperty({ example: '+628123456789', description: 'Indonesian mobile, +628…' })
  @IsString()
  @Matches(/^\+628\d{7,11}$/, { message: 'applicantPhone harus format +628xxxxxxxxx' })
  applicantPhone!: string;

  @ApiProperty({ example: 'BDG-02', description: 'Depot code the applicant proposes.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  proposedCode!: string;

  @ApiProperty({ example: 'Depot Buah Batu' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  proposedName!: string;

  @ApiProperty({ example: 'Bandung' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  city!: string;

  @ApiProperty({ example: 'Jawa Barat' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  province!: string;

  @ApiProperty({ example: -6.9421, description: 'Proposed location latitude.' })
  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @ApiProperty({ example: 107.6386, description: 'Proposed location longitude.' })
  @Type(() => Number)
  @IsLongitude()
  lng!: number;

  @ApiProperty({ example: 150_000_000, description: 'Planned investment in IDR.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  investmentAmount!: number;

  @ApiProperty({ example: 45_000_000, description: 'Projected monthly revenue in IDR.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  projectedMonthlyRevenue!: number;

  /*
   * CA-3-53. The only unauthenticated write in this service collects a name, a WhatsApp
   * number and a GPS pin, and asked for consent nowhere — not on the form, not here. The
   * tick is REQUIRED at the API boundary and not only in the browser, because a checkbox
   * the client alone enforces is a checkbox `curl` never sees.
   *
   * ponytail: the fact of consent is carried by the refusal, not by a stored timestamp —
   * every row accepted after this release was accepted with the box ticked. The ceiling:
   * a `privacyConsentAt` column when someone has to prove WHEN a specific applicant
   * agreed. That is a migration, and this repo lands a column one release before the code
   * that writes it.
   */
  @ApiProperty({
    example: true,
    description: 'Applicant ticked the privacy-policy consent. Must be true (UU PDP).',
  })
  @IsBoolean()
  @Equals(true, { message: 'privacyConsent wajib true — persetujuan pemrosesan data.' })
  privacyConsent!: boolean;
}

/**
 * What the applicant gets back. A receipt, not the record: an anonymous submitter has no
 * business reading the HQ pipeline stage or the reviewers' checklist.
 */
export class SubmittedApplicationView {
  @ApiProperty() id!: string;
  @ApiProperty() proposedCode!: string;
  @ApiProperty() proposedName!: string;
  @ApiProperty() submittedAt!: Date;

  static from(r: FranchiseApplicationRecord): SubmittedApplicationView {
    return {
      id: r.id,
      proposedCode: r.proposedCode,
      proposedName: r.proposedName,
      submittedAt: r.submittedAt,
    };
  }
}

/**
 * Retention sweep body. admin-service computes the cutoff from the retention policy;
 * depot-service only owns the rows, never the rule. Same shape as delivery-service's
 * `PurgeProofsDto`, because it is the same purge engine on the other end.
 */
export class PurgeRejectedApplicationsDto {
  @ApiProperty({ type: String, format: 'date-time' })
  @IsISO8601()
  cutoff!: string;
}

/** What the sweep reads back. `deleted` is the field every purge executor looks for. */
export class PurgeRejectedResponseDto {
  @ApiProperty({ example: 3 })
  deleted!: number;
}
