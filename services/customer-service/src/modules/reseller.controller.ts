import {
  BadRequestException,
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

import { AuthenticatedUser, CurrentUser, Role, Roles } from '@hydromart/platform';

import { ResellerService } from '../application/services/reseller.service';
import {
  CustomerNotFoundError,
  ResellerExistsError,
  ResellerNotFoundError,
} from '../domain/errors';
import { ListResellerQueryDto, RegisterResellerDto, UpdateResellerDto } from './dto/reseller.dto';

const RESELLER_ROLES = [Role.HEAD_OFFICE, Role.DEPOT_MANAGER, Role.SUPER_ADMIN] as const;

@ApiTags('Resellers')
@ApiBearerAuth()
@Roles(...RESELLER_ROLES)
@Controller({ path: 'resellers', version: '1' })
export class ResellerController {
  constructor(private readonly resellers: ResellerService) {}

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

  @Post()
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
      if (e instanceof CustomerNotFoundError) throw new BadRequestException(e.message);
      if (e instanceof ResellerExistsError) throw new ConflictException(e.message);
      throw e;
    }
  }

  @Patch(':customerId')
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
