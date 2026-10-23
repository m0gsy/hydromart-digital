import { ApiProperty } from '@nestjs/swagger';

export class ShiftReminderResponseDto {
  @ApiProperty({ description: 'Employees reminded on this tick.' }) reminded!: number;
  @ApiProperty({ description: 'On the rota but already in, on leave, or without a login.' })
  skipped!: number;
  @ApiProperty({ description: 'Reminders that could not be sent.' }) failed!: number;
  @ApiProperty({ description: 'false when the round could not do its job; withholds the heartbeat.' })
  ok!: boolean;
}
