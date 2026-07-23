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

import { Public, Role, Roles } from '@hydromart/platform';

import { PromotionRecord } from '../application/ports/promotion.repository';
import { PromotionService } from '../application/services/promotion.service';
import { CreatePromotionDto, PromotionAnalyticsDto, UpdatePromotionDto } from './dto/promotion.dto';

// Promotions are authored by marketing/depot staff and shown to customers on Home.
const ADMIN_ROLES = [Role.MARKETING, Role.DEPOT_MANAGER, Role.SUPER_ADMIN] as const;
const READ_ROLES = [
  Role.MARKETING,
  Role.DEPOT_MANAGER,
  Role.HEAD_OFFICE,
  Role.SUPER_ADMIN,
] as const;

const toDate = (iso?: string): Date | undefined => (iso ? new Date(iso) : undefined);

@ApiTags('Promotions')
@Controller({ path: 'promotions', version: '1' })
export class PromotionController {
  constructor(private readonly promotions: PromotionService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'List live promotions for the customer Home page' })
  listActive(): Promise<PromotionRecord[]> {
    return this.promotions.listActive();
  }

  @ApiBearerAuth()
  @Roles(...READ_ROLES)
  @Get('admin')
  @ApiOperation({ summary: 'List all promotions (admin, includes inactive/scheduled)' })
  listAll(): Promise<PromotionRecord[]> {
    return this.promotions.listAll();
  }

  @ApiBearerAuth()
  @Roles(...READ_ROLES)
  @Get(':id/analytics')
  @ApiOperation({ summary: 'Read authoritative usage and order-value analytics for a promotion' })
  @ApiOkResponse({ type: PromotionAnalyticsDto })
  async analytics(@Param('id', ParseUUIDPipe) id: string): Promise<PromotionAnalyticsDto> {
    return PromotionAnalyticsDto.from(await this.promotions.analytics(id));
  }

  @ApiBearerAuth()
  @Roles(...ADMIN_ROLES)
  @Post()
  @ApiOperation({ summary: 'Create a promotion (admin)' })
  create(@Body() dto: CreatePromotionDto): Promise<PromotionRecord> {
    return this.promotions.create({
      title: dto.title,
      subtitle: dto.subtitle ?? null,
      imageUrl: dto.imageUrl ?? null,
      ctaLabel: dto.ctaLabel ?? null,
      ctaHref: dto.ctaHref ?? null,
      voucherCode: dto.voucherCode ?? null,
      sortOrder: dto.sortOrder ?? 0,
      startsAt: toDate(dto.startsAt) ?? null,
      endsAt: toDate(dto.endsAt) ?? null,
    });
  }

  @ApiBearerAuth()
  @Roles(...ADMIN_ROLES)
  @Patch(':id')
  @ApiOperation({ summary: 'Update a promotion (admin)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePromotionDto,
  ): Promise<PromotionRecord> {
    return this.promotions.update(id, {
      title: dto.title,
      subtitle: dto.subtitle,
      imageUrl: dto.imageUrl,
      ctaLabel: dto.ctaLabel,
      ctaHref: dto.ctaHref,
      voucherCode: dto.voucherCode,
      sortOrder: dto.sortOrder,
      active: dto.active,
      startsAt: toDate(dto.startsAt),
      endsAt: toDate(dto.endsAt),
    });
  }

  @ApiBearerAuth()
  @Roles(...ADMIN_ROLES)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a promotion (admin)' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.promotions.remove(id);
  }
}
