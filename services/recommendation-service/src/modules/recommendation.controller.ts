import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser, Public, Role, Roles } from '@hydromart/platform';

import { RecItem, RecommendationService } from '../application/services/recommendation.service';
import { RebuildService } from '../application/services/rebuild.service';
import { LimitQueryDto, RebuildQueryDto, TrendingQueryDto } from './dto/recommendation.dto';

const DEFAULT_LIMIT = 10;
const DEFAULT_TRENDING_DAYS = 7;
const DEFAULT_REBUILD_LIMIT = 100;

@ApiTags('Recommendations')
@Controller({ path: 'recommendations', version: '1' })
export class RecommendationController {
  constructor(
    private readonly recommendations: RecommendationService,
    private readonly rebuild: RebuildService,
  ) {}

  // Static routes (reorder/trending/rebuild) are declared before the `:productId` route
  // below to avoid capture; `products/:productId/related` is unambiguous either way since
  // it starts with the distinct literal segment "products".

  @ApiBearerAuth()
  @Roles(Role.CUSTOMER)
  @Get('reorder')
  @ApiOperation({ summary: 'Products the current customer is likely to reorder' })
  async reorder(@CurrentUser() user: AuthenticatedUser, @Query() query: LimitQueryDto): Promise<RecItem[]> {
    return this.recommendations.reorder(user.sub, query.limit ?? DEFAULT_LIMIT);
  }

  @Public()
  @Get('trending')
  @ApiOperation({ summary: 'Trending products, optionally scoped to a depot' })
  async trending(@Query() query: TrendingQueryDto): Promise<RecItem[]> {
    return this.recommendations.trending(
      query.depotId ?? null,
      query.days ?? DEFAULT_TRENDING_DAYS,
      query.limit ?? DEFAULT_LIMIT,
    );
  }

  @ApiBearerAuth()
  @Roles(Role.SUPER_ADMIN)
  @Post('rebuild')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rebuild the read model from order-service completed orders (backfill)' })
  async rebuildNow(@Query() query: RebuildQueryDto): Promise<{ ingested: number }> {
    return this.rebuild.run(query.limit ?? DEFAULT_REBUILD_LIMIT);
  }

  @Public()
  @Get('products/:productId/related')
  @ApiOperation({ summary: 'Products frequently bought together with the given product' })
  async related(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query() query: LimitQueryDto,
  ): Promise<RecItem[]> {
    return this.recommendations.related(productId, query.limit ?? DEFAULT_LIMIT);
  }
}
