import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser } from '@hydromart/platform';

import { FavoriteService } from '../application/services/favorite.service';
import { AddFavoriteDto } from './dto/favorite.dto';

@ApiTags('Favorites')
@ApiBearerAuth()
@Controller({ path: 'favorites', version: '1' })
export class FavoriteController {
  constructor(private readonly favorites: FavoriteService) {}

  @Get()
  @ApiOperation({ summary: 'List my favorited product ids (newest first)' })
  async list(@CurrentUser() user: AuthenticatedUser): Promise<{ productIds: string[] }> {
    return { productIds: await this.favorites.list(user.sub) };
  }

  @Post()
  @ApiOperation({ summary: 'Favorite a product (idempotent)' })
  async add(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddFavoriteDto,
  ): Promise<{ productIds: string[] }> {
    return { productIds: await this.favorites.add(user.sub, dto.productId) };
  }

  @Delete(':productId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unfavorite a product (idempotent, no-op if absent)' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId') productId: string,
  ): Promise<void> {
    await this.favorites.remove(user.sub, productId);
  }
}
