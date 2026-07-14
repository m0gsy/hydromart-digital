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

import { PRODUCT_TOKENS } from '../application/tokens';
import { StoragePort } from '../application/ports/storage.port';
import { MulterExceptionFilter } from './multer-exception.filter';

const ADMIN_ROLES = [Role.DEPOT_MANAGER, Role.SUPER_ADMIN] as const;
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Admin uploads a product image and gets back a URL to store as `imageUrl`. */
@ApiTags('Products')
@ApiBearerAuth()
@Roles(...ADMIN_ROLES)
@UseFilters(MulterExceptionFilter)
@Controller({ path: 'products', version: '1' })
export class UploadController {
  constructor(@Inject(PRODUCT_TOKENS.Storage) private readonly storage: StoragePort) {}

  @Post('images')
  @ApiOperation({ summary: 'Upload a product image; returns its URL (admin)' })
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
