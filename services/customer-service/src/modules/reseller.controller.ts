import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Can, AuthenticatedUser, CurrentUser, ImportSummary } from '@hydromart/platform';

import { CustomerImportService } from '../application/services/customer-import.service';
import { ResellerService } from '../application/services/reseller.service';
import {
  ResellerExistsError,
  ResellerNotFoundError,
} from '../domain/errors';
import { ListResellerQueryDto, RegisterResellerDto, UpdateResellerDto } from './dto/reseller.dto';
import { ImportResellersDto } from './dto/customer-import.dto';
import { Reseller } from '../application/ports/reseller.repository';
import { ImportResponseDto, ResellerResponseDto } from './dto/responses.generated.dto';

@ApiTags('Resellers')
@ApiBearerAuth()
@Can('resellerView')
@Controller({ path: 'resellers', version: '1' })
export class ResellerController {
  constructor(
    private readonly resellers: ResellerService,
    private readonly imports: CustomerImportService,
  ) {}

  @ApiOkResponse({ type: ResellerResponseDto, isArray: true })
  @Get()
  @ApiOperation({ summary: 'List resellers (optionally by depot / active)' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() q: ListResellerQueryDto): Promise<Reseller[]> {
    return this.resellers.list(user, { homeDepotId: q.depotId, active: q.active });
  }

  @Get(':customerId')
  @ApiOperation({ summary: 'Get one reseller' })
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('customerId', ParseUUIDPipe) customerId: string,
  ) {
    try {
      return await this.resellers.get(user, customerId);
    } catch (e) {
      if (e instanceof ResellerNotFoundError) throw new NotFoundException(e.message);
      throw e;
    }
  }

  @ApiOkResponse({ type: ImportResponseDto })
  @Post('import')
  @Can('resellerAdmin')
  @ApiOperation({ summary: 'Bulk-import resellers from the CSV wizard (pre-registers new phones)' })
  import(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ImportResellersDto,
  ): Promise<ImportSummary> {
    return this.imports.importResellers(user, dto.depotId, dto.rows);
  }

  @Post()
  @Can('resellerAdmin')
  @ApiOperation({ summary: 'Register an existing customer as a reseller' })
  async register(@CurrentUser() user: AuthenticatedUser, @Body() dto: RegisterResellerDto) {
    try {
      return await this.resellers.register(user, {
        customerId: dto.customerId,
        homeDepotId: dto.homeDepotId,
        monthlyTargetQty: dto.monthlyTargetQty,
        discountPct: dto.discountPct,
        joinDate: new Date(dto.joinDate),
        note: dto.note,
      });
    } catch (e) {
      if (e instanceof ResellerExistsError) throw new ConflictException(e.message);
      throw e;
    }
  }

  @Patch(':customerId')
  @Can('resellerAdmin')
  @ApiOperation({ summary: 'Edit a reseller (target / depot / note / active)' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: UpdateResellerDto,
  ) {
    try {
      return await this.resellers.update(user, customerId, dto);
    } catch (e) {
      if (e instanceof ResellerNotFoundError) throw new NotFoundException(e.message);
      throw e;
    }
  }
}
