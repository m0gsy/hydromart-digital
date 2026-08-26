import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser, Public } from '@hydromart/platform';

import { CartService, CartView } from '../application/services/cart.service';
import { AddCartItemDto, SetCartItemQuantityDto, ShelfPricesResponseDto } from './dto/cart.dto';
import { CartResponseDto } from './dto/responses.generated.dto';

/*
 * A2: every route takes an optional `depotId`.
 *
 * The cart had no depot context at all, so it could not price anything the way checkout
 * does — one rule per depot, and the cart knew none of them. The client sends the depot
 * it is ordering to (the address's depot at checkout, the browsing location otherwise);
 * omitting it is still valid and answers with catalog prices, flagged as such.
 *
 * It is a query parameter rather than a body field because the mutation routes answer
 * with the whole priced cart too — a client that only sent it on GET would watch prices
 * flip on every quantity tap.
 */
const DEPOT_QUERY = {
  name: 'depotId',
  required: false,
  description: 'Depot to price the cart at. Omitted = catalog base prices (pricingBasis CATALOG).',
} as const;

@ApiTags('Cart')
@ApiBearerAuth()
@Controller({ path: 'cart', version: '1' })
export class CartController {
  constructor(private readonly cart: CartService) {}

  /**
   * PG-03 — the shelf price, for the catalogue grid and the product page.
   *
   * Public, like the catalogue itself: a guest browsing sees prices before they have an
   * account. It answers from the same `priceLines` the cart bills through, so the number on
   * the shelf and the number on the bill cannot be produced by two different rules — which
   * is what they were.
   */
  @ApiOkResponse({ type: ShelfPricesResponseDto })
  @Public()
  @Get('shelf-prices')
  @ApiOperation({ summary: "Depot-resolved shelf prices for products (public, PG-03)" })
  shelfPrices(
    @Query('productIds') productIds?: string,
    @Query('depotId') depotId?: string,
  ): Promise<ShelfPricesResponseDto> {
    const ids = (productIds ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 100); // one page of a catalogue; a longer list is a caller bug, not a query
    return this.cart.shelfPrices(depotId ?? null, ids);
  }

  @ApiOkResponse({ type: CartResponseDto })
  @ApiQuery(DEPOT_QUERY)
  @Get()
  @ApiOperation({ summary: "Get the current customer's cart with live pricing" })
  view(
    @CurrentUser() user: AuthenticatedUser,
    @Query('depotId') depotId?: string,
    @Headers('authorization') authorization?: string,
  ): Promise<CartView> {
    return this.cart.view(user.sub, depotId ?? null, authorization ?? '');
  }

  @ApiOkResponse({ type: CartResponseDto })
  @ApiQuery(DEPOT_QUERY)
  @Post('items')
  @ApiOperation({ summary: 'Add a quantity of a product to the cart' })
  add(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddCartItemDto,
    @Query('depotId') depotId?: string,
    @Headers('authorization') authorization?: string,
  ): Promise<CartView> {
    return this.cart.setItem(
      user.sub,
      dto.productId,
      dto.quantity,
      false,
      depotId ?? null,
      authorization ?? '',
    );
  }

  @ApiOkResponse({ type: CartResponseDto })
  @ApiQuery(DEPOT_QUERY)
  @Put('items/:productId')
  @ApiOperation({ summary: 'Set the absolute quantity for a product in the cart' })
  set(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: SetCartItemQuantityDto,
    @Query('depotId') depotId?: string,
    @Headers('authorization') authorization?: string,
  ): Promise<CartView> {
    return this.cart.setItem(
      user.sub,
      productId,
      dto.quantity,
      true,
      depotId ?? null,
      authorization ?? '',
    );
  }

  @ApiOkResponse({ type: CartResponseDto })
  @ApiQuery(DEPOT_QUERY)
  @Delete('items/:productId')
  @ApiOperation({ summary: 'Remove a product from the cart' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query('depotId') depotId?: string,
    @Headers('authorization') authorization?: string,
  ): Promise<CartView> {
    return this.cart.removeItem(user.sub, productId, depotId ?? null, authorization ?? '');
  }

  @ApiOkResponse({ description: 'No content.' })
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Empty the cart' })
  async clear(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.cart.clear(user.sub);
  }
}
