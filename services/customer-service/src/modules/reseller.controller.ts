import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  PayloadTooLargeException,
  Post,
  Query,
  ServiceUnavailableException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import {
  Can,
  AuthenticatedUser,
  CurrentUser,
  ImportSummary,
  SNIFFED_MIME,
  sniffFileType,
} from '@hydromart/platform';

import { CUSTOMER_TOKENS } from '../application/tokens';
import { StoragePort } from '../application/ports/storage.port';

import { CustomerImportService } from '../application/services/customer-import.service';
import { ResellerService, ResellerView } from '../application/services/reseller.service';
import {
  NothingToScheduleError,
  ResellerExistsError,
  ResellerNotFoundError,
} from '../domain/errors';
import { ListResellerQueryDto, RegisterResellerDto, UpdateResellerDto } from './dto/reseller.dto';
import { ImportResellersDto } from './dto/customer-import.dto';
import {
  ImportResponseDto,
  ResellerPriceChangeResponseDto,
  ResellerResponseDto,
} from './dto/responses.generated.dto';

// Multipart agen photo (SOP §7). Minimal file shape avoids a hard @types/multer dep —
// same trick depot-service's QRIS upload uses.
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

@ApiTags('Resellers')
@ApiBearerAuth()
@Can('resellerView')
@Controller({ path: 'resellers', version: '1' })
export class ResellerController {
  private readonly logger = new Logger(ResellerController.name);

  constructor(
    private readonly resellers: ResellerService,
    private readonly imports: CustomerImportService,
    @Inject(CUSTOMER_TOKENS.Storage) private readonly storage: StoragePort,
  ) {}

  @ApiOkResponse({ type: ResellerResponseDto, isArray: true })
  @Get()
  @ApiOperation({ summary: 'List resellers (optionally by depot / active)' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() q: ListResellerQueryDto,
  ): Promise<ResellerView[]> {
    return this.resellers.list(user, { homeDepotId: q.depotId, active: q.active });
  }

  @Get(':customerId')
  @ApiOperation({ summary: 'Get one reseller' })
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('customerId', ParseUUIDPipe) customerId: string,
  ) {
    try {
      return await this.resellers.get(user, customerId);
    } catch (e) {
      if (e instanceof ResellerNotFoundError) throw new NotFoundException(e.message);
      throw e;
    }
  }

  @ApiOkResponse({ type: ImportResponseDto })
  @Post('import')
  @Can('resellerAdmin')
  @ApiOperation({ summary: 'Bulk-import resellers from the CSV wizard (pre-registers new phones)' })
  import(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ImportResellersDto,
  ): Promise<ImportSummary> {
    return this.imports.importResellers(user, dto.depotId, dto.rows);
  }

  @Post()
  @Can('resellerAdmin')
  @ApiOperation({ summary: 'Register an existing customer as a reseller' })
  async register(@CurrentUser() user: AuthenticatedUser, @Body() dto: RegisterResellerDto) {
    try {
      return await this.resellers.register(user, {
        customerId: dto.customerId,
        homeDepotId: dto.homeDepotId,
        monthlyTargetQty: dto.monthlyTargetQty,
        discountPct: dto.discountPct,
        flatGallonPriceIdr: dto.flatGallonPriceIdr,
        joinDate: new Date(dto.joinDate),
        note: dto.note,
      });
    } catch (e) {
      if (e instanceof ResellerExistsError) throw new ConflictException(e.message);
      throw e;
    }
  }

  /**
   * SOP §7: the agen's registration photo. Stored on the existing photo path (S3 driver +
   * STORAGE_PUBLIC_BASE_URL), not a new one, and the URL lands on the reseller record.
   */
  @ApiOkResponse({ type: ResellerResponseDto })
  @Can('resellerAdmin')
  @Post(':customerId/photo')
  @ApiOperation({ summary: "Upload the agen's registration photo; returns the updated row" })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: PHOTO_MAX_BYTES } }))
  async uploadPhoto(
    @CurrentUser() user: AuthenticatedUser,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @UploadedFile() file?: UploadedImage,
  ) {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    // H-20: `file.mimetype` is whatever the client typed into the multipart part. Trust the
    // bytes — the bucket serves what lands there straight back to a browser, so an .svg or
    // an .html wearing an image/jpeg label is a stored XSS.
    const sniffed = sniffFileType(file.buffer);
    const ext = sniffed && sniffed !== 'pdf' ? sniffed : undefined;
    if (!ext) {
      throw new BadRequestException('unsupported file type (allowed: jpeg, png, webp)');
    }
    if (file.size > PHOTO_MAX_BYTES) {
      throw new PayloadTooLargeException('file exceeds 5MB');
    }
    let url: string;
    try {
      ({ url } = await this.storage.put({
        body: file.buffer,
        contentType: SNIFFED_MIME[ext],
        ext,
      }));
    } catch (error) {
      this.logger.error(`Agen photo upload failed for ${customerId}: ${(error as Error).message}`);
      throw new ServiceUnavailableException(
        'Penyimpanan foto sedang tidak tersedia. Coba lagi sebentar lagi.',
      );
    }
    try {
      return await this.resellers.update(user, customerId, { photoUrl: url });
    } catch (e) {
      if (e instanceof ResellerNotFoundError) throw new NotFoundException(e.message);
      throw e;
    }
  }

  /**
   * K4.2. `effectiveAt` in the future schedules the price/status half instead of applying
   * it: the row comes back unchanged, and the agen keeps today's terms until the date they
   * were told about. Everything else on the patch is still instant.
   */
  @Patch(':customerId')
  @Can('resellerAdmin')
  @ApiOperation({ summary: 'Edit a reseller (target / depot / note / active), optionally from a date' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: UpdateResellerDto,
  ) {
    const { effectiveAt, ...patch } = dto;
    try {
      return await this.resellers.update(
        user,
        customerId,
        patch,
        effectiveAt ? new Date(effectiveAt) : undefined,
      );
    } catch (e) {
      if (e instanceof ResellerNotFoundError) throw new NotFoundException(e.message);
      if (e instanceof NothingToScheduleError) throw new BadRequestException(e.message);
      throw e;
    }
  }

  /** K4.2: who changed this agen's terms, when, and what is still coming. */
  @ApiOkResponse({ type: ResellerPriceChangeResponseDto, isArray: true })
  @Get(':customerId/price-changes')
  @ApiOperation({ summary: "One agen's price/status change history, newest first" })
  async priceChanges(
    @CurrentUser() user: AuthenticatedUser,
    @Param('customerId', ParseUUIDPipe) customerId: string,
  ) {
    try {
      return await this.resellers.priceHistory(user, customerId);
    } catch (e) {
      if (e instanceof ResellerNotFoundError) throw new NotFoundException(e.message);
      throw e;
    }
  }
}
