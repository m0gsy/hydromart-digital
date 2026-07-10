import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser } from '@hydromart/platform';

import { CartService, CartView } from '../application/services/cart.service';
import { AddCartItemDto, SetCartItemQuantityDto } from './dto/cart.dto';

@ApiTags('Cart')
@ApiBearerAuth()
@Controller({ path: 'cart', version: '1' })
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  @ApiOperation({ summary: "Get the current customer's cart with live pricing" })
  view(@CurrentUser() user: AuthenticatedUser): Promise<CartView> {
    return this.cart.view(user.sub);
  }

  @Post('items')
  @ApiOperation({ summary: 'Add a quantity of a product to the cart' })
  add(@CurrentUser() user: AuthenticatedUser, @Body() dto: AddCartItemDto): Promise<CartView> {
    return this.cart.setItem(user.sub, dto.productId, dto.quantity, false);
  }

  @Put('items/:productId')
  @ApiOperation({ summary: 'Set the absolute quantity for a product in the cart' })
  set(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: SetCartItemQuantityDto,
  ): Promise<CartView> {
    return this.cart.setItem(user.sub, productId, dto.quantity, true);
  }

  @Delete('items/:productId')
  @ApiOperation({ summary: 'Remove a product from the cart' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<CartView> {
    return this.cart.removeItem(user.sub, productId);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Empty the cart' })
  async clear(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.cart.clear(user.sub);
  }
}
