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
import { ApiBearerAuth, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Can, SNIFFED_MIME, sniffFileType } from '@hydromart/platform';

import { PRODUCT_TOKENS } from '../application/tokens';
import { StoragePort } from '../application/ports/storage.port';
import { MulterExceptionFilter } from './multer-exception.filter';
import { Upload3ResponseDto } from './dto/responses.generated.dto';

const MAX_BYTES = 5 * 1024 * 1024;
/** Admin uploads a product image and gets back a URL to store as `imageUrl`. */
@ApiTags('Products')
@ApiBearerAuth()
@Can('catalogWrite')
@UseFilters(MulterExceptionFilter)
@Controller({ path: 'products', version: '1' })
export class UploadController {
  private readonly logger = new Logger(UploadController.name);

  constructor(@Inject(PRODUCT_TOKENS.Storage) private readonly storage: StoragePort) {}

  @ApiOkResponse({ type: Upload3ResponseDto })
  @Post('images')
  @ApiOperation({ summary: 'Upload a product image; returns its URL (admin)' })
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
    // Same fault class as M1-10 in auth-service: unreachable/misconfigured object
    // storage is infrastructure, not a bad request. 503 + a logged cause, never a
    // bare 500.
    try {
      const { url } = await this.storage.put({
        body: file.buffer,
        contentType: SNIFFED_MIME[ext],
        ext,
      });
      return { url };
    } catch (error) {
      this.logger.error(`Product image upload failed: ${(error as Error).message}`);
      throw new ServiceUnavailableException(
        'Penyimpanan gambar sedang tidak tersedia. Coba lagi sebentar lagi.',
      );
    }
  }
}
