import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CAPABILITIES } from '@hydromart/access';
import { AuthenticatedUser, CurrentUser, Roles } from '@hydromart/platform';

import { AssetService } from '../application/services/asset.service';
import { CreateAssetDto, ListAssetDto, MoveAssetDto, UpdateAssetDto } from './dto/asset.dto';

/** Company property tracking. Read hrView, write hrAdmin. */
@ApiTags('HR Assets')
@ApiBearerAuth()
@Controller({ path: 'employee-assets', version: '1' })
export class AssetController {
  constructor(private readonly assets: AssetService) {}

  @Get()
  @Roles(...CAPABILITIES.hrView)
  @ApiOperation({ summary: 'List assets (filter by depot, status, type or current holder)' })
  list(@Query() q: ListAssetDto, @CurrentUser() user: AuthenticatedUser) {
    return this.assets.list(user, q);
  }

  @Get(':id')
  @Roles(...CAPABILITIES.hrView)
  @ApiOperation({ summary: 'One asset with its full append-only movement history' })
  getById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.assets.getById(user, id);
  }

  @Post()
  @Roles(...CAPABILITIES.hrAdmin)
  @ApiOperation({ summary: 'Register an asset (starts AVAILABLE, held by nobody)' })
  create(@Body() dto: CreateAssetDto, @CurrentUser() user: AuthenticatedUser) {
    return this.assets.create(user, dto);
  }

  @Patch(':id')
  @Roles(...CAPABILITIES.hrAdmin)
  @ApiOperation({ summary: 'Edit asset details — status and holder move via /movements only' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAssetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assets.update(user, id, dto);
  }

  @Post(':id/movements')
  @Roles(...CAPABILITIES.hrAdmin)
  @ApiOperation({ summary: 'Hand over, transfer, take back, service or write off an asset' })
  move(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveAssetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assets.move(user, id, dto);
  }
}
