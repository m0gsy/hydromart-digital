import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDefined, IsNotEmpty, IsString, MaxLength, ValidateNested } from 'class-validator';

import { SavedSegmentRecord } from '../../application/ports/saved-segment.repository';
import { CampaignSegmentDto } from './campaign.dto';

export class SaveSegmentDto {
  @ApiProperty({ example: 'Pelanggan berisiko churn' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  // The SAME validated shape a campaign takes. A saved segment that could hold conditions
  // no campaign accepts would be a definition nobody can send to.
  @ApiProperty({ type: CampaignSegmentDto })
  // @ValidateNested() alone passes a body that has no conditions at all; @IsDefined() is what
  // turns that into a 400 instead of saving `undefined` as the audience.
  @IsDefined()
  @ValidateNested()
  @Type(() => CampaignSegmentDto)
  conditions!: CampaignSegmentDto;
}

export class SavedSegmentDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  name!: string;
  @ApiProperty({ type: CampaignSegmentDto })
  conditions!: CampaignSegmentDto;
  @ApiProperty({ description: 'Staff user who saved it.' })
  createdBy!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  static from(record: SavedSegmentRecord): SavedSegmentDto {
    return {
      id: record.id,
      name: record.name,
      conditions: record.conditions as CampaignSegmentDto,
      createdBy: record.createdBy,
      createdAt: record.createdAt,
    };
  }
}
