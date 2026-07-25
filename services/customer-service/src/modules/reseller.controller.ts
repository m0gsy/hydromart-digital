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

import { Role, Roles } from '@hydromart/platform';

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
  list(@Query() q: ListResellerQueryDto) {
    return this.resellers.list({ homeDepotId: q.depotId, active: q.active });
  }

  @Get(':customerId')
  @ApiOperation({ summary: 'Get one reseller' })
  async get(@Param('customerId', ParseUUIDPipe) customerId: string) {
    try {
      return await this.resellers.get(customerId);
    } catch (e) {
      if (e instanceof ResellerNotFoundError) throw new NotFoundException(e.message);
      throw e;
    }
  }

  @Post()
  @ApiOperation({ summary: 'Register an existing customer as a reseller' })
  async register(@Body() dto: RegisterResellerDto) {
    try {
      return await this.resellers.register({
        customerId: dto.customerId,
        homeDepotId: dto.homeDepotId,
        monthlyTargetQty: dto.monthlyTargetQty,
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
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: UpdateResellerDto,
  ) {
    try {
      return await this.resellers.update(customerId, dto);
    } catch (e) {
      if (e instanceof ResellerNotFoundError) throw new NotFoundException(e.message);
      throw e;
    }
  }
}
