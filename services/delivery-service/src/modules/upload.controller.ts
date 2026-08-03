import {
  BadRequestException,
  Controller,
  Inject,
  Logger,
  PayloadTooLargeException,
  Post,
  ServiceUnavailableException,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Role, Roles, SNIFFED_MIME, sniffFileType } from '@hydromart/platform';

import { DELIVERY_TOKENS } from '../application/tokens';
import { StoragePort } from '../application/ports/storage.port';
import { MulterExceptionFilter } from './multer-exception.filter';

const MAX_BYTES = 5 * 1024 * 1024;
/** Driver uploads a PoD photo/signature and gets back a URL to submit to /complete. */
@ApiTags('Driver Deliveries')
@ApiBearerAuth()
@Roles(Role.STAFF_DEPOT)
@UseFilters(MulterExceptionFilter)
@Controller({ path: 'driver/deliveries', version: '1' })
export class UploadController {
  private readonly logger = new Logger(UploadController.name);

  constructor(@Inject(DELIVERY_TOKENS.Storage) private readonly storage: StoragePort) {}

  @Post('uploads')
  @ApiOperation({ summary: 'Upload a PoD photo or signature; returns its URL' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async upload(@UploadedFile() file?: Express.Multer.File): Promise<{ url: string }> {
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
    if (file.size > MAX_BYTES) {
      throw new PayloadTooLargeException('file exceeds 5MB');
    }
    // Same fault class as M1-10 in auth-service. A courier losing a PoD photo to a
    // bare 500 mid-delivery is the worst version of this bug, so fail loudly here:
    // 503 tells the app the upload is retryable, and the cause lands in the log.
    try {
      const { url } = await this.storage.put({
        body: file.buffer,
        contentType: SNIFFED_MIME[ext],
        ext,
      });
      return { url };
    } catch (error) {
      this.logger.error(`PoD upload failed: ${(error as Error).message}`);
      throw new ServiceUnavailableException(
        'Penyimpanan foto sedang tidak tersedia. Coba lagi sebentar lagi.',
      );
    }
  }
}
