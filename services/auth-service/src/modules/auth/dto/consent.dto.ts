import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn } from 'class-validator';

import {
  CONSENT_PURPOSES,
  ConsentPurpose,
  ConsentRecord,
} from '../../../domain/data-subject/consent';
import { ConsentStateEntry } from '../../../application/services/consent.service';

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

  static from(entry: ConsentStateEntry): ConsentStateDto {
    return {
      purpose: entry.purpose,
      granted: entry.granted,
      mandatory: entry.mandatory,
      withdrawable: entry.withdrawable,
      decidedAt: entry.decidedAt ? entry.decidedAt.toISOString() : null,
      documentVersion: entry.documentVersion,
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
