import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

import { CreatePurchaseOrderDto } from './procurement.dto';
import { ProposePriceOverrideDto } from './price-override.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** HD-17: why the AI drafted it; shown to the person who decides. Max 500 characters. */
export const AI_REASON_MAX = 500;

export class AiPriceOverrideDraftDto extends ProposePriceOverrideDto {
  @ApiProperty({ format: 'uuid', description: 'Depot the proposal is for.' })
  @IsUUID()
  depotId!: string;

  @ApiProperty({ maxLength: AI_REASON_MAX, description: 'Why the AI proposes this price.' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(AI_REASON_MAX)
  reason!: string;
}

export class AiPurchaseOrderDraftDto extends CreatePurchaseOrderDto {
  @ApiProperty({ maxLength: AI_REASON_MAX, description: 'Why the AI proposes this order.' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(AI_REASON_MAX)
  reason!: string;
}
