import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * HD-18: the WhatsApp number n8n asks about. The field is called `msisdn` on purpose: the audit
 * interceptor redacts any body key matching /msisdn/, so the number never reaches the trail.
 */
export class MachineOrdersByPhoneDto {
  @ApiProperty({ example: '081234567890', description: 'Any common spelling of an Indonesian mobile number.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  msisdn!: string;
}

export class MachineOrderItemDto {
  @ApiProperty() name!: string;
  @ApiProperty() quantity!: number;
}

export class MachineOrderDto {
  @ApiProperty({ example: 'HM-20261125-000123' }) orderNumber!: string;
  @ApiProperty({ example: '2026-11-25 09:41', description: 'When the order was made, WIB.' }) createdAt!: string;
  @ApiProperty({ type: [MachineOrderItemDto] }) items!: MachineOrderItemDto[];
  @ApiProperty({ description: 'IDR' }) total!: number;
  @ApiProperty({ nullable: true, type: String, description: 'payment-service status (PENDING, PAID, ...); null when unknown.' })
  paymentStatus!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'payment-service method (CASH, TRANSFER, QRIS, ...); null when unknown.' })
  paymentMethod!: string | null;
  @ApiProperty({
    description:
      'CREATED, CONFIRMED, PREPARING, DRIVER_ASSIGNED, PICKED_UP, ON_DELIVERY, DELIVERED, COMPLETED, CANCELLED or VOIDED.',
  })
  status!: string;
  @ApiProperty({ nullable: true, type: String }) depot!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'The window the customer picked, as typed.' })
  deliveryWindow!: string | null;
  @ApiProperty({ nullable: true, type: String, example: '2026-11-26 09:00', description: 'The booked slot start, WIB.' })
  scheduledFor!: string | null;
}

export class MachineOrdersResultDto {
  @ApiProperty({
    type: [MachineOrderDto],
    description: 'Running orders, then the last 3 finished or cancelled. Empty for an unknown number.',
  })
  orders!: MachineOrderDto[];
}

/** crm-service asks for subscription deliveries in `[from, to)`: the WIB day it computed. */
export class DueWindowDto {
  @ApiProperty() @IsISO8601({ strict: true }) from!: string;
  @ApiProperty() @IsISO8601({ strict: true }) to!: string;
}
