import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  PayloadTooLargeException,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, AuthenticatedUser, InternalAuthGuard, Public, Role, Roles } from '@hydromart/platform';
import { CAPABILITIES } from '@hydromart/access';

import { DepotService, NearbyDepot } from '../application/services/depot.service';
import { DepotRecord } from '../application/ports/depot.repository';
import { Page } from '../application/pagination';
import {
  BrowseDepotsQueryDto,
  CreateDepotDto,
  NearbyDepotsQueryDto,
  UpdateDepotDto,
} from './dto/depot.dto';

// Multipart QRIS image (design 4b). Minimal file shape avoids a hard @types/multer dep.
const QRIS_MAX_BYTES = 5 * 1024 * 1024;
const QRIS_ALLOWED: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

@ApiTags('Depots')
@Controller({ path: 'depots', version: '1' })
export class DepotController {
  constructor(private readonly depots: DepotService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Browse depots (paginated, active only)' })
  browse(@Query() query: BrowseDepotsQueryDto): Promise<Page<DepotRecord>> {
    return this.depots.browse(query, true);
  }

  // Static `nearby` segment declared before `:id` so it is not swallowed by the param route.
  @Public()
  @Get('nearby')
  @ApiOperation({ summary: 'Find active depots near a coordinate (nearest first)' })
  nearby(@Query() query: NearbyDepotsQueryDto): Promise<NearbyDepot[]> {
    return this.depots.findNearby(query.lat, query.lng, query.limit ?? 10);
  }

  // Service-to-service: forecast-service resolves which depots a franchise owner owns so it
  // can reject a forecast query for a depot they don't own (forecast has no ownership data of
  // its own). No end-user token — authenticated by the shared INTERNAL_SERVICE_KEY. Declared
  // before `:id` so it is not swallowed by that param route.
  @Public()
  @UseGuards(InternalAuthGuard)
  @Get('internal/owned/:ownerId')
  @ApiOperation({ summary: 'Depot IDs owned by a franchise owner (internal service auth)' })
  async internalOwned(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
  ): Promise<{ depotIds: string[] }> {
    const depots = await this.depots.listMine(ownerId);
    return { depotIds: depots.map((d) => d.id) };
  }

  // Admin listing includes inactive depots (public browse is active-only), so a
  // deactivated depot stays reachable to reactivate. Declared before `:id`.
  @ApiBearerAuth()
  @Roles(...CAPABILITIES.depotAdmin)
  @Get('manage')
  @ApiOperation({ summary: 'List all depots incl. inactive (admin)' })
  manage(@Query() query: BrowseDepotsQueryDto): Promise<Page<DepotRecord>> {
    return this.depots.browse(query, false);
  }

  // Franchise owner's own depots (active + inactive). Declared before `:id` so the
  // static `mine` segment wins the route match.
  @ApiBearerAuth()
  @Roles(Role.FRANCHISE_OWNER)
  @Get('mine')
  @ApiOperation({ summary: 'List depots managed by the calling franchise owner' })
  mine(@CurrentUser() user: AuthenticatedUser): Promise<DepotRecord[]> {
    return this.depots.listMine(user.sub);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get an active depot by id' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<DepotRecord> {
    return this.depots.get(id, true);
  }

  @ApiBearerAuth()
  @Roles(...CAPABILITIES.depotAdmin)
  @Post()
  @ApiOperation({ summary: 'Create a depot (admin)' })
  create(@Body() dto: CreateDepotDto): Promise<DepotRecord> {
    return this.depots.create({
      code: dto.code,
      name: dto.name,
      ownershipType: dto.ownershipType,
      address: dto.address,
      city: dto.city,
      province: dto.province,
      lat: dto.lat,
      lng: dto.lng,
      serviceRadiusKm: dto.serviceRadiusKm ?? 5,
      deliveryFee: dto.deliveryFee,
      minOrderAmount: dto.minOrderAmount ?? null,
      ownerId: dto.ownerId ?? null,
      paymentBankName: dto.paymentBankName ?? null,
      paymentBankAccountNumber: dto.paymentBankAccountNumber ?? null,
      paymentBankAccountHolder: dto.paymentBankAccountHolder ?? null,
      paymentQrisImageUrl: dto.paymentQrisImageUrl ?? null,
      operatingHours: dto.operatingHours ?? {},
      holidays: dto.holidays ?? [],
    });
  }

  @ApiBearerAuth()
  @Roles(...CAPABILITIES.depotAdmin)
  @Patch(':id')
  @ApiOperation({ summary: 'Update a depot: hours, delivery zone/fee, holidays (admin)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDepotDto,
  ): Promise<DepotRecord> {
    return this.depots.update(id, dto);
  }

  @ApiBearerAuth()
  @Roles(...CAPABILITIES.depotAdmin)
  @Post(':id/qris')
  @ApiOperation({ summary: 'Upload the depot static QRIS image (admin); returns the updated depot' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: QRIS_MAX_BYTES } }))
  async uploadQris(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: UploadedImage,
  ): Promise<DepotRecord> {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    const ext = QRIS_ALLOWED[file.mimetype];
    if (!ext) {
      throw new BadRequestException('unsupported file type (allowed: jpeg, png, webp)');
    }
    if (file.size > QRIS_MAX_BYTES) {
      throw new PayloadTooLargeException('file exceeds 5MB');
    }
    // TODO wire object storage — persist file.buffer via a StoragePort and store its
    // public URL. Until then we record a deterministic path so the config UI has a value.
    const url = `/uploads/qris/${id}.${ext}`;
    return this.depots.update(id, { paymentQrisImageUrl: url });
  }

  @ApiBearerAuth()
  @Roles(...CAPABILITIES.depotAdmin)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a depot (soft delete, admin)' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<DepotRecord> {
    return this.depots.deactivate(id);
  }
}
