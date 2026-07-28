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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  AuthenticatedUser,
  CurrentUser,
  ImportSummary,
  Roles,
} from '@hydromart/platform';
import { CAPABILITIES } from '@hydromart/access';

import { CustomerImportService } from '../application/services/customer-import.service';
import { ResellerService } from '../application/services/reseller.service';
import {
  ResellerExistsError,
  ResellerNotFoundError,
} from '../domain/errors';
import { ListResellerQueryDto, RegisterResellerDto, UpdateResellerDto } from './dto/reseller.dto';
import { ImportResellersDto } from './dto/customer-import.dto';


@ApiTags('Resellers')
@ApiBearerAuth()
@Roles(...CAPABILITIES.resellerView)
@Controller({ path: 'resellers', version: '1' })
export class ResellerController {
  constructor(
    private readonly resellers: ResellerService,
    private readonly imports: CustomerImportService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List resellers (optionally by depot / active)' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() q: ListResellerQueryDto) {
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

  @Post('import')
  @Roles(...CAPABILITIES.resellerAdmin)
  @ApiOperation({ summary: 'Bulk-import resellers from the CSV wizard (pre-registers new phones)' })
  import(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ImportResellersDto,
  ): Promise<ImportSummary> {
    return this.imports.importResellers(user, dto.depotId, dto.rows);
  }

  @Post()
  @Roles(...CAPABILITIES.resellerAdmin)
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
  @Roles(...CAPABILITIES.resellerAdmin)
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
