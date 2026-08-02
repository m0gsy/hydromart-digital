import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Param,
  ParseUUIDPipe,
  Patch,
  PayloadTooLargeException,
  Post,
  Query,
  ServiceUnavailableException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Can, CurrentUser, AuthenticatedUser, InternalAuthGuard, Public, Role, Roles } from '@hydromart/platform';

import { OwnershipType } from '../domain/inventory';
import { DEPOT_TOKENS } from '../application/tokens';
import { StoragePort } from '../application/ports/storage.port';
import { DepotService, NearbyDepot } from '../application/services/depot.service';
import { DepotRecord } from '../application/ports/depot.repository';
import { Page } from '../application/pagination';
import {
  BrowseDepotsQueryDto,
  CreateDepotDto,
  DepotPaymentInfoView,
  NearbyDepotsQueryDto,
  PublicDepotView,
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
  private readonly logger = new Logger(DepotController.name);

  constructor(
    private readonly depots: DepotService,
    @Inject(DEPOT_TOKENS.Storage) private readonly storage: StoragePort,
  ) {}

  // Anonymous browse: the trimmed projection only. Serving the whole DepotRecord here
  // published every depot's bank account to the open internet — see PublicDepotView.
  @Public()
  @Get()
  @ApiOperation({ summary: 'Browse depots (paginated, active only)' })
  async browse(@Query() query: BrowseDepotsQueryDto): Promise<Page<PublicDepotView>> {
    const page = await this.depots.browse(query, true);
    return { ...page, items: page.items.map(PublicDepotView.from) };
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

  // Service-to-service: order-service asks who owns the fulfilling depot so a completed
  // order can be credited to that franchise owner's payout ledger. Ownership is kept out
  // of the public depot projection on purpose, hence the internal-key route.
  @Public()
  @UseGuards(InternalAuthGuard)
  @Get('internal/:id/owner')
  @ApiOperation({ summary: 'Franchise owner of one depot (internal service auth)' })
  async internalOwner(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ ownerId: string | null; ownershipType: OwnershipType }> {
    const depot = await this.depots.get(id, false);
    // ownershipType rides along so the caller can tell "company depot, nobody to credit"
    // from "franchise depot missing its owner" — the second one is a defect worth logging.
    return { ownerId: depot.ownerId, ownershipType: depot.ownershipType };
  }

  // Admin listing includes inactive depots (public browse is active-only), so a
  // deactivated depot stays reachable to reactivate. Declared before `:id`.
  @ApiBearerAuth()
  @Can('depotAdmin')
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

  // Full record for staff/owner tooling (edit forms, HQ onboarding, payment setup).
  // Declared before ':id' so the static `manage` segment wins the route match.
  @ApiBearerAuth()
  @Can('depotDirectory')
  @Get('manage/:id')
  @ApiOperation({ summary: 'Get one depot in full, incl. payment + ownership (staff)' })
  async manageOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DepotRecord> {
    const depot = await this.depots.get(id, false);
    // A franchise owner may only open their OWN depot's record.
    if (user.role === Role.FRANCHISE_OWNER && depot.ownerId !== user.sub) {
      throw new ForbiddenException('This depot belongs to another owner.');
    }
    return depot;
  }

  // Where to send money for ONE depot. Any signed-in user (a customer paying for an
  // order needs it), never anonymous and never in bulk.
  @ApiBearerAuth()
  @Get(':id/payment-info')
  @ApiOperation({ summary: "A depot's payment destination (signed-in callers)" })
  async paymentInfo(@Param('id', ParseUUIDPipe) id: string): Promise<DepotPaymentInfoView> {
    return DepotPaymentInfoView.from(await this.depots.get(id, true));
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get an active depot by id (public projection)' })
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<PublicDepotView> {
    return PublicDepotView.from(await this.depots.get(id, true));
  }

  @ApiBearerAuth()
  @Can('depotAdmin')
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
  @Can('depotAdmin')
  @Patch(':id')
  @ApiOperation({ summary: 'Update a depot: hours, delivery zone/fee, holidays (admin)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDepotDto,
  ): Promise<DepotRecord> {
    return this.depots.update(id, dto);
  }

  @ApiBearerAuth()
  @Can('depotAdmin')
  @Post(':id/qris')
  @ApiOperation({
    summary: 'Upload the depot static QRIS image (admin); returns the updated depot',
  })
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
    // The stored URL is ABSOLUTE and public: the customer's payment screen renders it with
    // no console base URL to prepend. This used to record `/uploads/qris/<id>.<ext>` without
    // writing the file anywhere, so every QRIS was a broken image on both sides.
    let url: string;
    try {
      ({ url } = await this.storage.put({
        body: file.buffer,
        contentType: file.mimetype,
        ext,
      }));
    } catch (error) {
      this.logger.error(`QRIS upload failed for depot ${id}: ${(error as Error).message}`);
      throw new ServiceUnavailableException(
        'Penyimpanan gambar sedang tidak tersedia. Coba lagi sebentar lagi.',
      );
    }
    return this.depots.update(id, { paymentQrisImageUrl: url });
  }

  @ApiBearerAuth()
  @Can('depotAdmin')
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a depot (soft delete, admin)' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<DepotRecord> {
    return this.depots.deactivate(id);
  }
}
