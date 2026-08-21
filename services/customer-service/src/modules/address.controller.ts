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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';

import {
  AuthenticatedUser,
  CurrentUser,
  InternalAuthGuard,
  Public,
} from '@hydromart/platform';

import { AddressService } from '../application/services/address.service';
import { AddressRecord } from '../application/ports/address.repository';
import { CreateAddressDto, UpdateAddressDto } from './dto/address.dto';
import { AddressResponseDto } from './dto/responses.generated.dto';

@ApiTags('Addresses')
@ApiBearerAuth()
@Controller({ path: 'addresses', version: '1' })
export class AddressController {
  constructor(private readonly addresses: AddressService) {}

  @ApiOkResponse({ type: AddressResponseDto, isArray: true })
  @Get()
  @ApiOperation({ summary: 'List my delivery addresses' })
  list(@CurrentUser() user: AuthenticatedUser): Promise<AddressRecord[]> {
    return this.addresses.list(user.sub);
  }

  /**
   * D10: the address a depot-created subscription delivers to.
   *
   * Internal key, not a user token: the caller is order-service building a subscription
   * that depot staff asked for, and it holds no token for the customer in question. The
   * customer id comes from the depot console's own picked customer, never from a browser.
   *
   * Declared before the `:id` route so the static `internal` segment cannot be read as an
   * address id.
   */
  @ApiOkResponse({ type: AddressResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('internal/primary')
  @ApiOperation({ summary: "One customer's primary delivery address (internal)" })
  primary(@Query('customerId', ParseUUIDPipe) customerId: string): Promise<AddressRecord | null> {
    return this.addresses.primary(customerId);
  }

  @ApiOkResponse({ type: AddressResponseDto })
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

  @ApiOkResponse({ type: AddressResponseDto })
  @Patch(':id')
  @ApiOperation({ summary: 'Update one of my addresses' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAddressDto,
  ): Promise<AddressRecord> {
    return this.addresses.update(user.sub, id, dto);
  }

  @ApiOkResponse({ type: AddressResponseDto })
  @Post(':id/primary')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set an address as primary' })
  setPrimary(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AddressRecord> {
    return this.addresses.setPrimary(user.sub, id);
  }

  @ApiOkResponse({ description: 'No content.' })
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
