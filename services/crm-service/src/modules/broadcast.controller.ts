import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser, Role, Roles } from '@hydromart/platform';
import { CAPABILITIES } from '@hydromart/access';

import { BroadcastService } from '../application/services/broadcast.service';
import { BroadcastDto, BroadcastQueryDto, CreateBroadcastDto } from './dto/broadcast.dto';

@ApiTags('Broadcasts')
@ApiBearerAuth()
@Controller({ path: 'broadcasts', version: '1' })
export class BroadcastController {
  constructor(private readonly broadcasts: BroadcastService) {}

  // Depot ops post an announcement to their depot. Staff JWTs carry no depotId, so it is
  // supplied in the body (same as delivery-service). MVP ceiling: the depotId is trusted,
  // not cross-checked against the poster's depot assignment.
  @Roles(...CAPABILITIES.depotBroadcast)
  @Post()
  @ApiOperation({ summary: 'Post a depot broadcast to its couriers (design 8a)' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBroadcastDto,
  ): Promise<BroadcastDto> {
    const record = await this.broadcasts.create(user.sub, dto.depotId, dto.title, dto.body, dto.level);
    return BroadcastDto.fromRecord(record);
  }

  // Courier inbox: broadcasts for the courier's depot with per-courier read flags. The
  // courier passes their own assigned depot; broadcasts are low-sensitivity ops notices.
  @Roles(Role.DRIVER)
  @Get()
  @ApiOperation({ summary: "List a depot's broadcasts for the current courier" })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: BroadcastQueryDto,
  ): Promise<BroadcastDto[]> {
    const records = await this.broadcasts.listForCourier(query.depotId, user.sub);
    return records.map((r) => BroadcastDto.fromCourier(r));
  }

  @Roles(Role.DRIVER)
  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark a broadcast read for the current courier' })
  async markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.broadcasts.markRead(id, user.sub);
  }
}
