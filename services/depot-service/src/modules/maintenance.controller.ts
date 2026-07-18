import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '@hydromart/platform';
import { CAPABILITIES } from '@hydromart/access';

import { MaintenanceService } from '../application/services/maintenance.service';
import { MaintenanceItem } from '../domain/maintenance';
import { CreateMaintenanceDto, ListMaintenanceQueryDto } from './dto/maintenance.dto';

/** Depot equipment/vehicle maintenance schedule (depot admin). */
@ApiTags('Maintenance')
@ApiBearerAuth()
@Roles(...CAPABILITIES.depotAdmin)
@Controller({ path: 'maintenance-items', version: '1' })
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Post()
  @ApiOperation({ summary: 'Add a maintenance item (status derived from next-due date)' })
  create(@Body() dto: CreateMaintenanceDto): Promise<MaintenanceItem> {
    return this.maintenance.create({
      depotId: dto.depotId,
      name: dto.name,
      category: dto.category,
      intervalDays: dto.intervalDays,
      nextDueAt: new Date(dto.nextDueAt),
      lastServicedAt: dto.lastServicedAt ? new Date(dto.lastServicedAt) : null,
      note: dto.note ?? null,
    });
  }

  @Get()
  @ApiOperation({ summary: "List a depot's maintenance items (next-due first), status recomputed" })
  list(@Query() query: ListMaintenanceQueryDto): Promise<MaintenanceItem[]> {
    return this.maintenance.list(query.depotId);
  }

  @Patch(':id/serviced')
  @ApiOperation({ summary: 'Mark serviced now (bumps next-due by the interval)' })
  markServiced(@Param('id', ParseUUIDPipe) id: string): Promise<MaintenanceItem> {
    return this.maintenance.markServiced(id);
  }
}
