import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  PayloadTooLargeException,
  Post,
  ServiceUnavailableException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  AuthenticatedUser,
  Can,
  CurrentUser,
  Public,
  SNIFFED_MIME,
  depotScopeIds,
  sniffFileType,
} from '@hydromart/platform';

import { PromotionRecord } from '../application/ports/promotion.repository';
import { StoragePort } from '../application/ports/storage.port';
import { PromotionService } from '../application/services/promotion.service';
import { PROMO_TOKENS } from '../application/tokens';
import { CreatePromotionDto, PromotionAnalyticsDto, UpdatePromotionDto } from './dto/promotion.dto';
import { PromotionResponseDto } from './dto/responses.generated.dto';

// Minimal multipart file shape — the same trick depot/customer-service's upload routes
// use to avoid a hard @types/multer dependency.
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
interface UploadedImage {
  buffer: Buffer;
  size: number;
}

// Promotions are authored by marketing/depot staff and shown to customers on Home.
//
// These used to be two hand-written role arrays right here — the last controller in the
// repo still doing that. The console asked @hydromart/access who may read a promotion and
// this file answered differently, which is exactly how the depot operator ended up with a
// Promo tab the server refused. Same powers, now declared in the one map, which also means
// a super admin can retune them without a deploy.

const toDate = (iso?: string): Date | undefined => (iso ? new Date(iso) : undefined);

@ApiTags('Promotions')
@Controller({ path: 'promotions', version: '1' })
export class PromotionController {
  constructor(
    private readonly promotions: PromotionService,
    @Inject(PROMO_TOKENS.Storage) private readonly storage: StoragePort,
  ) {}

  /**
   * Item 8 (2026 evaluation list): the admin form had a plain "image URL" text field —
   * an external link whoever controlled it could swap or take down. Upload-first: the
   * admin picks a file here, gets back a URL, and sets it on the form exactly like the
   * old text field did. No promotion id needed — a NEW promo has none yet.
   */
  @ApiOkResponse({ description: 'The uploaded banner image, as an absolute URL.' })
  @ApiBearerAuth()
  @Can('promotionWrite')
  @Post('upload-image')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMAGE_MAX_BYTES } }))
  @ApiOperation({ summary: 'Upload a promo banner image; returns its URL' })
  async uploadImage(@UploadedFile() file?: UploadedImage): Promise<{ url: string }> {
    if (!file) throw new BadRequestException('file is required');
    if (file.size > IMAGE_MAX_BYTES) throw new PayloadTooLargeException('file exceeds 5MB');
    // H-20: trust the bytes, never the client-supplied mimetype — the bucket serves
    // whatever lands there straight back to every customer's browser on Home.
    const sniffed = sniffFileType(file.buffer);
    const ext = sniffed && sniffed !== 'pdf' ? sniffed : undefined;
    if (!ext) throw new BadRequestException('unsupported file type (allowed: jpeg, png, webp)');
    try {
      const { url } = await this.storage.put({
        body: file.buffer,
        contentType: SNIFFED_MIME[ext],
        ext,
      });
      return { url };
    } catch {
      throw new ServiceUnavailableException('Penyimpanan gambar sedang tidak tersedia. Coba lagi.');
    }
  }

  @ApiOkResponse({ type: PromotionResponseDto, isArray: true })
  @Public()
  @Get()
  @ApiOperation({ summary: 'List live promotions for the customer Home page' })
  listActive(): Promise<PromotionRecord[]> {
    return this.promotions.listActive();
  }

  @ApiOkResponse({ type: PromotionResponseDto, isArray: true })
  @ApiBearerAuth()
  @Can('promotionRead')
  @Get('admin')
  @ApiOperation({ summary: 'List all promotions (admin, includes inactive/scheduled)' })
  listAll(): Promise<PromotionRecord[]> {
    return this.promotions.listAll();
  }

  @ApiBearerAuth()
  @Can('promotionRead')
  @Get(':id/analytics')
  @ApiOperation({ summary: 'Read authoritative usage and order-value analytics for a promotion' })
  @ApiOkResponse({ type: PromotionAnalyticsDto })
  async analytics(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PromotionAnalyticsDto> {
    return PromotionAnalyticsDto.from(
      await this.promotions.analytics(id, new Date(), depotScopeIds(user)),
    );
  }

  @ApiOkResponse({ type: PromotionResponseDto })
  @ApiBearerAuth()
  @Can('promotionWrite')
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

  @ApiOkResponse({ type: PromotionResponseDto })
  @ApiBearerAuth()
  @Can('promotionWrite')
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
    }, dto.seenUpdatedAt);
  }

  @ApiOkResponse({ description: 'No content.' })
  @ApiBearerAuth()
  @Can('promotionWrite')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a promotion (admin)' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.promotions.remove(id);
  }
}
