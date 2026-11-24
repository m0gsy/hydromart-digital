import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsUUID } from 'class-validator';

import { Role } from '@hydromart/platform';

import { PENDING_QUEUE_KEYS } from '../../application/ports/pending-approval-sources.port';

/** One queue the caller decides (contracts/ai-v1/approvals.openapi.json, PendingQueue). */
export class PendingQueueResponseDto {
  @ApiProperty({ enum: PENDING_QUEUE_KEYS })
  key!: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Items waiting for this caller. Null only together with error: never read it as 0.',
  })
  count!: number | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'UTC time the oldest counted item was raised; null when none waits or unavailable.',
  })
  oldestAt!: string | null;

  @ApiProperty({ example: '/hq/pricing', description: 'Where the caller acts on it, in the hydromart-digital web.' })
  href!: string;

  @ApiPropertyOptional({ enum: ['unavailable'], description: "Present when the queue's service could not answer." })
  error?: 'unavailable';
}

export class PendingApprovalsResponseDto {
  @ApiProperty({
    type: [PendingQueueResponseDto],
    description: 'The queues the caller decides, in a fixed order. A queue they do not decide is absent.',
  })
  queues!: PendingQueueResponseDto[];
}

/** AI-9: crm asks for one account's queues (internal key). */
export class PendingForAccountQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  accountId!: string;

  // Internal-key only, and answered only for a network-wide role (PendingApprovalsService.forAccount).
  @ApiProperty({ example: 'DIREKTUR', enum: Object.values(Role) })
  @IsIn(Object.values(Role))
  role!: string;
}
