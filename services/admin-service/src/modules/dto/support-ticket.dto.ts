import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { TicketAuthorType, TicketPriority, TicketStatus } from '../../domain/ticket';
import {
  SupportTicketRecord,
  TicketMessageRecord,
} from '../../application/ports/support-ticket.repository';

/* ---------- Requests ---------- */

export class SupportTicketQueryDto {
  @ApiPropertyOptional({ enum: TicketStatus })
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @ApiPropertyOptional({ enum: TicketPriority })
  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;
}

/**
 * A ticket raised by staff on a customer's behalf (counter or phone).
 *
 * `customerRef` is free text, not a uuid: the person complaining at the counter is very
 * often not a registered account, and refusing to record their complaint because they have
 * no id is how a complaint stops existing.
 */
export class CreateTicketDto {
  @ApiProperty({ example: 'Galon bocor saat diterima' })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  subject!: string;

  @ApiProperty({ example: 'Ibu Rina (Depot Cibubur)' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  customerRef!: string;

  @ApiProperty({ example: '081234567890' })
  @IsString()
  @MinLength(5)
  @MaxLength(30)
  customerPhone!: string;

  @ApiPropertyOptional({ example: 'HM-260816-001' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  orderRef?: string;

  @ApiPropertyOptional({ enum: TicketPriority })
  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @ApiProperty({ description: 'The complaint itself — becomes the first message.' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;
}

export class ReplyTicketDto {
  @ApiProperty({ example: 'We have re-dispatched your order.' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;
}

export class AssignTicketDto {
  @ApiProperty({ description: 'Staff account id to assign the ticket to.' })
  @IsString()
  @MaxLength(200)
  assigneeId!: string;
}

/* ---------- Responses ---------- */

export class TicketMessageDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ enum: TicketAuthorType })
  authorType!: TicketAuthorType;
  @ApiProperty()
  body!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  static from(record: TicketMessageRecord): TicketMessageDto {
    return {
      id: record.id,
      authorType: record.authorType,
      body: record.body,
      createdAt: record.createdAt.toISOString(),
    };
  }
}

export class SupportTicketDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  subject!: string;
  @ApiProperty()
  customerRef!: string;
  @ApiProperty()
  customerPhone!: string;
  @ApiProperty({ nullable: true })
  orderRef!: string | null;
  @ApiProperty({ enum: TicketPriority })
  priority!: TicketPriority;
  @ApiProperty({ enum: TicketStatus })
  status!: TicketStatus;
  @ApiProperty({ nullable: true })
  assigneeId!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: [TicketMessageDto] })
  messages!: TicketMessageDto[];

  static from(record: SupportTicketRecord): SupportTicketDto {
    return {
      id: record.id,
      subject: record.subject,
      customerRef: record.customerRef,
      customerPhone: record.customerPhone,
      orderRef: record.orderRef,
      priority: record.priority,
      status: record.status,
      assigneeId: record.assigneeId,
      createdAt: record.createdAt.toISOString(),
      messages: record.messages.map(TicketMessageDto.from),
    };
  }
}
