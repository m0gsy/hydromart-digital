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
import { ApiBearerAuth, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Can, CurrentUser, AuthenticatedUser, InternalAuthGuard, Public, Role, Roles, SNIFFED_MIME, sniffFileType } from '@hydromart/platform';

import { OwnershipType } from '../domain/inventory';
import { DEPOT_TOKENS } from '../application/tokens';
import { StoragePort } from '../application/ports/storage.port';
import { DepotService } from '../application/services/depot.service';
import { DepotRecord } from '../application/ports/depot.repository';
import { Page } from '../application/pagination';
import {
  BrowseDepotsQueryDto,
  CreateDepotDto,
  DepotContactView,
  DepotPaymentInfoView,
  NearbyDepotsQueryDto,
  NearbyDepotView,
  PublicDepotView,
  UpdateDepotDto,
} from './dto/depot.dto';
import { DepotResponseDto, InternalContactsResponseDto, InternalOwnedResponseDto, InternalOwnerResponseDto, NearbyDepotResponseDto, PagedDepotResponseDto, PagedPublicDepotResponseDto } from './dto/responses.generated.dto';

// Multipart QRIS image (design 4b). Minimal file shape avoids a hard @types/multer dep.
const QRIS_MAX_BYTES = 5 * 1024 * 1024;
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
  @ApiOkResponse({ type: PagedPublicDepotResponseDto })
  @Public()
  @Get()
  @ApiOperation({ summary: 'Browse depots (paginated, active only)' })
  async browse(@Query() query: BrowseDepotsQueryDto): Promise<Page<PublicDepotView>> {
    const page = await this.depots.browse(query, true);
    return { ...page, items: page.items.map(PublicDepotView.from) };
  }

  // Static `nearby` segment declared before `:id` so it is not swallowed by the param route.
  @ApiOkResponse({ type: NearbyDepotResponseDto, isArray: true })
  @Public()
  @Get('nearby')
  @ApiOperation({ summary: 'Find active depots near a coordinate (nearest first)' })
  async nearby(@Query() query: NearbyDepotsQueryDto): Promise<NearbyDepotView[]> {
    const found = await this.depots.findNearby(query.lat, query.lng, query.limit ?? 10);
    return found.map(NearbyDepotView.fromNearby);
  }

  // Service-to-service: forecast-service resolves which depots a franchise owner owns so it
  // can reject a forecast query for a depot they don't own (forecast has no ownership data of
  // its own). No end-user token — authenticated by the shared INTERNAL_SERVICE_KEY. Declared
  // before `:id` so it is not swallowed by that param route.
  @ApiOkResponse({ type: InternalOwnedResponseDto })
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
  @ApiOkResponse({ type: InternalOwnerResponseDto })
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

  /**
   * Service-to-service: every active depot's name and own WhatsApp number, for the SOP's
   * twice-daily sales update that order-service's cron sends.
   *
   * `contactPhone` is deliberately NOT in `PublicDepotView`. It belongs to depot staff and
   * would be harvestable in bulk from an anonymous route — the same objection that moved
   * the bank details behind a signed-in route. Internal key only.
   */
  @ApiOkResponse({ type: InternalContactsResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @Get('internal/contacts')
  @ApiOperation({ summary: 'Active depots with their own phone number (internal service auth)' })
  async internalContacts(): Promise<{
    depots: { id: string; name: string; contactPhone: string | null }[];
  }> {
    // listAllActive, not browse: browse clamps to 100 and the hundred-and-first depot
    // would silently never get its sales report.
    const depots = await this.depots.listAllActive();
    return {
      depots: depots.map((d) => ({ id: d.id, name: d.name, contactPhone: d.contactPhone })),
    };
  }

  // Admin listing includes inactive depots (public browse is active-only), so a
  // deactivated depot stays reachable to reactivate. Declared before `:id`.
  // `depotDirectory`, not `depotAdmin` — the same capability its read-one sibling
  // `manage/:id` carries twenty lines below. Listing depots is a READ, and gating it behind
  // the WRITE capability meant the network console could not enumerate its own network:
  // sixteen /hq pages read this list, and for HEAD_OFFICE and DIREKTUR — the two roles the
  // console admits — every one of them 403'd. On /hq/reconciliation that is a hard
  // `ErrorState`, so the whole page died. Creating, editing and deactivating a depot below
  // are still `depotAdmin`.
  @ApiOkResponse({ type: PagedDepotResponseDto })
  @ApiBearerAuth()
  @Can('depotDirectory')
  @Get('manage')
  @ApiOperation({ summary: 'List all depots incl. inactive (admin)' })
  manage(@Query() query: BrowseDepotsQueryDto): Promise<Page<DepotRecord>> {
    return this.depots.browse(query, false);
  }

  // Franchise owner's own depots (active + inactive). Declared before `:id` so the
  // static `mine` segment wins the route match.
  @ApiOkResponse({ type: DepotResponseDto, isArray: true })
  @ApiBearerAuth()
  @Roles(Role.FRANCHISE_OWNER)
  @Get('mine')
  @ApiOperation({ summary: 'List depots managed by the calling franchise owner' })
  mine(@CurrentUser() user: AuthenticatedUser): Promise<DepotRecord[]> {
    return this.depots.listMine(user.sub);
  }

  // Full record for staff/owner tooling (edit forms, HQ onboarding, payment setup).
  // Declared before ':id' so the static `manage` segment wins the route match.
  @ApiOkResponse({ type: DepotResponseDto })
  @ApiBearerAuth()
  @Can('depotDirectory')
  // AUTHZ-B1: the param is named `depotId`, not `id`, and that name is the whole guard.
  // `DepotScopeGuard` reads `depotId`/`depotIds` out of query, body and route params — a
  // route that calls its depot `:id` is invisible to it, so `depotDirectory` (KEPALA_DEPOT,
  // MANAGER — both depot-scoped) handed any depot's full record, bank account included, to
  // anyone who knew a UUID. Renaming the param changes no URL and adds no branch; it just
  // puts the value where the guard already looks.
  @Get('manage/:depotId')
  @ApiOperation({ summary: 'Get one depot in full, incl. payment + ownership (staff)' })
  async manageOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('depotId', ParseUUIDPipe) id: string,
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
  @ApiOkResponse({ type: DepotPaymentInfoView })
  @ApiBearerAuth()
  @Get(':id/payment-info')
  @ApiOperation({ summary: "A depot's payment destination (signed-in callers)" })
  async paymentInfo(@Param('id', ParseUUIDPipe) id: string): Promise<DepotPaymentInfoView> {
    return DepotPaymentInfoView.from(await this.depots.get(id, true));
  }

  // The depot's own phone, for the customer help screen. Same guard as payment-info and
  // for the same reason: one depot at a time to a signed-in caller is fine, a public bulk
  // directory of every depot's line is not. Declared before `:id` so it is not swallowed.
  @ApiOkResponse({ type: DepotContactView })
  @ApiBearerAuth()
  @Get(':id/contact')
  @ApiOperation({ summary: "A depot's contact phone (signed-in callers)" })
  async contact(@Param('id', ParseUUIDPipe) id: string): Promise<DepotContactView> {
    return DepotContactView.from(await this.depots.get(id, true));
  }

  @ApiOkResponse({ type: PublicDepotView })
  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get an active depot by id (public projection)' })
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<PublicDepotView> {
    return PublicDepotView.from(await this.depots.get(id, true));
  }

  @ApiOkResponse({ type: DepotResponseDto })
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
      contactPhone: dto.contactPhone ?? null,
      paymentBankName: dto.paymentBankName ?? null,
      paymentBankAccountNumber: dto.paymentBankAccountNumber ?? null,
      paymentBankAccountHolder: dto.paymentBankAccountHolder ?? null,
      paymentQrisImageUrl: dto.paymentQrisImageUrl ?? null,
      operatingHours: dto.operatingHours ?? {},
      holidays: dto.holidays ?? [],
    });
  }

  @ApiOkResponse({ type: DepotResponseDto })
  @ApiBearerAuth()
  @Can('depotAdmin')
  // AUTHZ-B1, and this is the one that moved money. `depotAdmin` is MANAGER + SUPER_ADMIN,
  // and MANAGER is depot-scoped — so with the param called `:id` a manager could PATCH the
  // bank account and QRIS of EVERY depot in the network, their own or not. Same rename, same
  // reason: `DepotScopeGuard` only ever looked for a parameter called `depotId`.
  @Patch(':depotId')
  @ApiOperation({ summary: 'Update a depot: hours, delivery zone/fee, holidays (admin)' })
  update(
    @Param('depotId', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDepotDto,
  ): Promise<DepotRecord> {
    return this.depots.update(id, dto);
  }

  @ApiOkResponse({ type: DepotResponseDto })
  @ApiBearerAuth()
  @Can('depotAdmin')
  // AUTHZ-B1 — see `update` above. Writing another depot's QRIS is writing where its
  // customers' money lands.
  @Post(':depotId/qris')
  @ApiOperation({
    summary: 'Upload the depot static QRIS image (admin); returns the updated depot',
  })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: QRIS_MAX_BYTES } }))
  async uploadQris(
    @Param('depotId', ParseUUIDPipe) id: string,
    @UploadedFile() file?: UploadedImage,
  ): Promise<DepotRecord> {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    // H-20: `file.mimetype` is the Content-Type the CLIENT typed into the multipart part.
    // Trust the bytes instead — the bucket serves whatever lands there straight back to
    // browsers, so a .html or an .svg wearing an image/jpeg label is a stored XSS.
    const sniffed = sniffFileType(file.buffer);
    const ext = sniffed && sniffed !== 'pdf' ? sniffed : undefined;
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
        contentType: SNIFFED_MIME[ext],
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

  @ApiOkResponse({ type: DepotResponseDto })
  @ApiBearerAuth()
  @Can('depotAdmin')
  // AUTHZ-B1 — see `update` above.
  @Delete(':depotId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a depot (soft delete, admin)' })
  remove(@Param('depotId', ParseUUIDPipe) id: string): Promise<DepotRecord> {
    return this.depots.deactivate(id);
  }
}
