import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

import {
  CONSENT_PURPOSES,
  ConsentPurpose,
  ConsentRecord,
} from '../../../domain/data-subject/consent';
import {
  ConsentLagReport,
  ConsentStateEntry,
  FLEET_LAG_MAX_LIMIT,
} from '../../../application/services/consent.service';
import {
  ConsentLagCustomer,
  ConsentLagTotals,
} from '../../../application/ports/consent.repository';

export class SetConsentDto {
  @ApiProperty({ enum: CONSENT_PURPOSES })
  @IsIn(CONSENT_PURPOSES)
  purpose!: ConsentPurpose;

  @ApiProperty({ description: 'false withdraws it; only optional purposes may be withdrawn.' })
  @IsBoolean()
  granted!: boolean;
}

export class ConsentStateDto {
  @ApiProperty({ enum: CONSENT_PURPOSES }) purpose!: ConsentPurpose;
  @ApiProperty() granted!: boolean;
  @ApiProperty({ description: 'Required to hold an account — cannot be withdrawn.' })
  mandatory!: boolean;
  @ApiProperty() withdrawable!: boolean;
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Null when this purpose was never put to the customer — not the same as refused.',
  })
  decidedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) documentVersion!: string | null;
  @ApiProperty({
    description:
      'Agreed to, but against wording that has since been replaced. A fact about the row, ' +
      'not a revocation: the consent still stands. False when there is no row at all — ' +
      '"never asked" has no document to be behind.',
  })
  outdated!: boolean;

  static from(entry: ConsentStateEntry): ConsentStateDto {
    return {
      purpose: entry.purpose,
      granted: entry.granted,
      mandatory: entry.mandatory,
      withdrawable: entry.withdrawable,
      decidedAt: entry.decidedAt ? entry.decidedAt.toISOString() : null,
      documentVersion: entry.documentVersion,
      // Computed since the ledger shipped and dropped on the way out until W10, which is
      // why no client could tell an up-to-date consent from a retired one.
      outdated: entry.outdated,
    };
  }
}

/**
 * "Do I have to accept anything again?" — asked by the account it is about, never on
 * behalf of another.
 */
export class ConsentPendingDto {
  @ApiProperty({ example: '2026-08-29', description: 'The Terms/Privacy version in force.' })
  documentVersion!: string;

  @ApiProperty({
    enum: CONSENT_PURPOSES,
    isArray: true,
    description:
      'Mandatory purposes still owed at that version: agreed under retired wording, or ' +
      'never recorded at all. MARKETING never appears — re-prompting an opt-in the ' +
      'customer then ignores would read as a withdrawal they did not make.',
  })
  purposes!: ConsentPurpose[];

  @ApiProperty({ description: 'Shorthand for `purposes.length > 0`.' })
  mustAccept!: boolean;

  @ApiProperty({
    enum: ['UNENFORCED'],
    description:
      'Said out loud rather than left to be assumed: nothing on the server blocks, ' +
      'downgrades or logs out an account because of this answer. Earlier consent is not ' +
      'revoked by a new version, so a customer who ignores the prompt keeps their account ' +
      'and their orders keep their lawful basis. Whether to re-prompt at all is the ' +
      "owner's call, not a default taken here.",
  })
  enforcement!: 'UNENFORCED';

  static from(documentVersion: string, purposes: ConsentPurpose[]): ConsentPendingDto {
    return {
      documentVersion,
      purposes,
      mustAccept: purposes.length > 0,
      enforcement: 'UNENFORCED',
    };
  }
}

/** Page bounds for the fleet report. Both optional; the ceiling is not. */
export class ConsentLagQueryDto {
  @ApiPropertyOptional({ default: 50, maximum: FLEET_LAG_MAX_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(FLEET_LAG_MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      "Keyset cursor: the previous page's `nextCursor`. Ordered by customer id, so a page " +
      'boundary is stable even while consents are being recorded underneath it.',
  })
  @IsOptional()
  @IsUUID()
  cursor?: string;
}

export class ConsentLagTotalsDto implements ConsentLagTotals {
  @ApiProperty({ description: 'Accounts in scope: role CUSTOMER, not deleted.' })
  population!: number;
  @ApiProperty({ description: 'Owe nothing: every mandatory purpose granted at this version.' })
  current!: number;
  @ApiProperty({
    description:
      'At least one mandatory purpose with NO row at all. Not a refusal — the question was ' +
      'never put to them.',
  })
  neverAsked!: number;
  @ApiProperty({
    description: 'At least one mandatory purpose whose newest row says no. An actual refusal.',
  })
  refused!: number;
  @ApiProperty({ description: 'At least one mandatory purpose granted against retired wording.' })
  outdated!: number;
}

export class ConsentLagCustomerDto {
  @ApiProperty({ format: 'uuid' }) customerId!: string;
  @ApiProperty({ enum: CONSENT_PURPOSES, isArray: true }) neverAsked!: ConsentPurpose[];
  @ApiProperty({ enum: CONSENT_PURPOSES, isArray: true }) refused!: ConsentPurpose[];
  @ApiProperty({ enum: CONSENT_PURPOSES, isArray: true }) outdated!: ConsentPurpose[];

  static from(row: ConsentLagCustomer): ConsentLagCustomerDto {
    // Id only, no name or phone: this is a compliance count, and a report that carries a
    // roster of identified people is a second copy of the customer base to leak.
    return {
      customerId: row.id,
      neverAsked: row.neverAsked,
      refused: row.refused,
      outdated: row.outdated,
    };
  }
}

export class ConsentLagReportDto {
  @ApiProperty({ example: '2026-08-29' }) documentVersion!: string;
  @ApiProperty({
    type: ConsentLagTotalsDto,
    description:
      'Only `current` is exclusive. neverAsked/refused/outdated overlap — one account can ' +
      'be in two of them — so they do not sum to `population`.',
  })
  totals!: ConsentLagTotalsDto;
  @ApiProperty({ type: ConsentLagCustomerDto, isArray: true })
  items!: ConsentLagCustomerDto[];
  @ApiProperty({ type: String, nullable: true, description: 'Null on the last page.' })
  nextCursor!: string | null;

  static from(report: ConsentLagReport): ConsentLagReportDto {
    return {
      documentVersion: report.documentVersion,
      totals: report.totals,
      items: report.items.map(ConsentLagCustomerDto.from),
      nextCursor: report.nextCursor,
    };
  }
}

export class ConsentHistoryEntryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: CONSENT_PURPOSES }) purpose!: ConsentPurpose;
  @ApiProperty() granted!: boolean;
  @ApiProperty() documentVersion!: string;
  @ApiProperty({ example: 'account-settings' }) source!: string;
  @ApiProperty({ type: String, format: 'date-time' }) recordedAt!: string;

  static from(record: ConsentRecord): ConsentHistoryEntryDto {
    return {
      id: record.id,
      purpose: record.purpose,
      granted: record.granted,
      documentVersion: record.documentVersion,
      source: record.source,
      recordedAt: record.recordedAt.toISOString(),
    };
  }
}
