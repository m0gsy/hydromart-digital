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

import { CurrentUser, AuthenticatedUser, Public, Role, Roles } from '@hydromart/platform';

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

  // Admin listing includes inactive depots (public browse is active-only), so a
  // deactivated depot stays reachable to reactivate. Declared before `:id`.
  @ApiBearerAuth()
  @Roles(...DEPOT_ADMIN_ROLES)
  @Get('manage')
  @ApiOperation({ summary: 'List all depots incl. inactive (admin)' })
  manage(@Query() query: BrowseDepotsQueryDto): Promise<Page<DepotRecord>> {
    return this.depots.browse(query, false);
  }

  // Franchise owner's own depots (active + inactive). Declared before `:id` so the
  // static `mine` segment wins the route match.
  @ApiBearerAuth()
  @Roles(Role.FRANCHISE_OWNER)
  @Get('mine')
  @ApiOperation({ summary: 'List depots managed by the calling franchise owner' })
  mine(@CurrentUser() user: AuthenticatedUser): Promise<DepotRecord[]> {
    return this.depots.listMine(user.sub);
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
      ownerId: dto.ownerId ?? null,
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
