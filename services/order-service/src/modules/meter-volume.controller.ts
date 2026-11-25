import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public } from '@hydromart/platform';

import { MeterService } from '../application/services/meter.service';
import { MeterVolumeDto } from './dto/meter-reading.dto';

/** HD-15: depot-service asks how much water went through a depot's meter, for maintenance by volume. */
@ApiTags('Reports')
@Controller({ path: 'reports/internal', version: '1' })
export class MeterVolumeController {
  constructor(private readonly meter: MeterService) {}

  @ApiOkResponse({ description: 'items, in the order asked: m3, readingDays (closed days used), spanDays (days in the range).' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('meter-volume')
  @HttpCode(200)
  @ApiOperation({ summary: 'Water through the meter per depot and WIB day range (internal service auth)' })
  async volume(@Body() body: MeterVolumeDto) {
    return {
      items: await Promise.all(body.ranges.map((r) => this.meter.volume(r.depotId, r.from, r.to))),
    };
  }
}
