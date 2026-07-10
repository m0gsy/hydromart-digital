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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser } from '@hydromart/platform';

import { AddressService } from '../application/services/address.service';
import { AddressRecord } from '../application/ports/address.repository';
import { CreateAddressDto, UpdateAddressDto } from './dto/address.dto';

@ApiTags('Addresses')
@ApiBearerAuth()
@Controller({ path: 'addresses', version: '1' })
export class AddressController {
  constructor(private readonly addresses: AddressService) {}

  @Get()
  @ApiOperation({ summary: 'List my delivery addresses' })
  list(@CurrentUser() user: AuthenticatedUser): Promise<AddressRecord[]> {
    return this.addresses.list(user.sub);
  }

  @Post()
  @ApiOperation({ summary: 'Add a delivery address (max 20, first becomes primary)' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAddressDto,
  ): Promise<AddressRecord> {
    return this.addresses.create(user.sub, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one of my addresses' })
  @ApiOkResponse()
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AddressRecord> {
    return this.addresses.getOrThrow(user.sub, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update one of my addresses' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAddressDto,
  ): Promise<AddressRecord> {
    return this.addresses.update(user.sub, id, dto);
  }

  @Post(':id/primary')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set an address as primary' })
  setPrimary(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AddressRecord> {
    return this.addresses.setPrimary(user.sub, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete one of my addresses' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.addresses.remove(user.sub, id);
  }
}
