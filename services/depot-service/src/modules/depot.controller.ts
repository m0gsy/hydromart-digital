import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public, Role, Roles } from '@hydromart/platform';

import { DepotService } from '../application/services/depot.service';
import { DepotRecord } from '../application/ports/depot.repository';
import { Page } from '../application/pagination';
import { BrowseDepotsQueryDto, CreateDepotDto, UpdateDepotDto } from './dto/depot.dto';

const DEPOT_ADMIN_ROLES = [Role.DEPOT_MANAGER, Role.SUPER_ADMIN] as const;

@ApiTags('Depots')
@Controller({ path: 'depots', version: '1' })
export class DepotController {
  constructor(private readonly depots: DepotService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Browse depots (paginated, active only)' })
  browse(@Query() query: BrowseDepotsQueryDto): Promise<Page<DepotRecord>> {
    return this.depots.browse(query, true);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get an active depot by id' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<DepotRecord> {
    return this.depots.get(id, true);
  }

  @ApiBearerAuth()
  @Roles(...DEPOT_ADMIN_ROLES)
  @Post()
  @ApiOperation({ summary: 'Create a depot (admin)' })
  create(@Body() dto: CreateDepotDto): Promise<DepotRecord> {
    return this.depots.create({
      code: dto.code,
      name: dto.name,
      ownershipType: dto.ownershipType,
      address: dto.address,
      city: dto.city,
      province: dto.province,
      lat: dto.lat,
      lng: dto.lng,
      serviceRadiusKm: dto.serviceRadiusKm ?? 5,
      deliveryFee: dto.deliveryFee,
      minOrderAmount: dto.minOrderAmount ?? null,
      operatingHours: dto.operatingHours ?? {},
      holidays: dto.holidays ?? [],
    });
  }

  @ApiBearerAuth()
  @Roles(...DEPOT_ADMIN_ROLES)
  @Patch(':id')
  @ApiOperation({ summary: 'Update a depot: hours, delivery zone/fee, holidays (admin)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDepotDto,
  ): Promise<DepotRecord> {
    return this.depots.update(id, dto);
  }

  @ApiBearerAuth()
  @Roles(...DEPOT_ADMIN_ROLES)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a depot (soft delete, admin)' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<DepotRecord> {
    return this.depots.deactivate(id);
  }
}
