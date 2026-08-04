import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, Can, CurrentUser, ImportSummary } from '@hydromart/platform';

import { AssetService } from '../application/services/asset.service';
import {
  CreateAssetDto,
  ImportAssetsDto,
  ListAssetDto,
  MoveAssetDto,
  UpdateAssetDto,
} from './dto/asset.dto';
import { AssetMovement, EmployeeAsset } from '../../prisma/generated/client';
import { EmployeeAssetResponseDto, GetByIdResponseDto, ImportResponseDto, List5ResponseDto } from './dto/responses.generated.dto';

/** Company property tracking. Read hrView, write hrAdmin. */
@ApiTags('HR Assets')
@ApiBearerAuth()
@Controller({ path: 'employee-assets', version: '1' })
export class AssetController {
  constructor(private readonly assets: AssetService) {}

  @ApiOkResponse({ type: List5ResponseDto })
  @Get()
  @Can('hrView')
  @ApiOperation({ summary: 'List assets (filter by depot, status, type or current holder)' })
  list(@Query() q: ListAssetDto, @CurrentUser() user: AuthenticatedUser): Promise<{ rows: EmployeeAsset[]; total: number }> {
    return this.assets.list(user, q);
  }

  @ApiOkResponse({ type: GetByIdResponseDto })
  @Get(':id')
  @Can('hrView')
  @ApiOperation({ summary: 'One asset with its full append-only movement history' })
  getById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser): Promise<EmployeeAsset & { movements: AssetMovement[] }> {
    return this.assets.getById(user, id);
  }

  @ApiOkResponse({ type: EmployeeAssetResponseDto })
  @Post()
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Register an asset (starts AVAILABLE, held by nobody)' })
  create(@Body() dto: CreateAssetDto, @CurrentUser() user: AuthenticatedUser): Promise<EmployeeAsset> {
    return this.assets.create(user, dto);
  }

  @ApiOkResponse({ type: ImportResponseDto })
  @Post('import')
  @Can('hrAdmin')
  @ApiOperation({
    summary: 'Bulk-import assets from the CSV wizard (optionally already handed out)',
  })
  import(@Body() dto: ImportAssetsDto, @CurrentUser() user: AuthenticatedUser): Promise<ImportSummary> {
    return this.assets.importMany(user, dto.rows);
  }

  @ApiOkResponse({ type: EmployeeAssetResponseDto })
  @Patch(':id')
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Edit asset details — status and holder move via /movements only' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAssetDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EmployeeAsset> {
    return this.assets.update(user, id, dto);
  }

  @ApiOkResponse({ type: EmployeeAssetResponseDto })
  @Post(':id/movements')
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Hand over, transfer, take back, service or write off an asset' })
  move(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveAssetDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EmployeeAsset> {
    return this.assets.move(user, id, dto);
  }
}
