import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsObject, IsOptional, Min } from 'class-validator';

import {
  Checklist,
  ChecklistItemStatus,
  FranchiseAppStage,
} from '../../domain/franchise-application';

export class ListApplicationsQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
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
