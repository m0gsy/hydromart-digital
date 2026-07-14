import {
  BadRequestException,
  Controller,
  Inject,
  PayloadTooLargeException,
  Post,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Role, Roles } from '@hydromart/platform';

import { DELIVERY_TOKENS } from '../application/tokens';
import { StoragePort } from '../application/ports/storage.port';
import { MulterExceptionFilter } from './multer-exception.filter';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Driver uploads a PoD photo/signature and gets back a URL to submit to /complete. */
@ApiTags('Driver Deliveries')
@ApiBearerAuth()
@Roles(Role.DRIVER)
@UseFilters(MulterExceptionFilter)
@Controller({ path: 'driver/deliveries', version: '1' })
export class UploadController {
  constructor(@Inject(DELIVERY_TOKENS.Storage) private readonly storage: StoragePort) {}

  @Post('uploads')
  @ApiOperation({ summary: 'Upload a PoD photo or signature; returns its URL' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async upload(@UploadedFile() file?: Express.Multer.File): Promise<{ url: string }> {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    const ext = ALLOWED[file.mimetype];
    if (!ext) {
      throw new BadRequestException('unsupported file type (allowed: jpeg, png, webp)');
    }
    if (file.size > MAX_BYTES) {
      throw new PayloadTooLargeException('file exceeds 5MB');
    }
    const { url } = await this.storage.put({ body: file.buffer, contentType: file.mimetype, ext });
    return { url };
  }
}
