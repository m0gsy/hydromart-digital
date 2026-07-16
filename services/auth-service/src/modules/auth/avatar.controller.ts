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
import { ApiBearerAuth, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AccountService } from '../../application/services/account.service';
import { StoragePort } from '../../application/ports/storage.port';
import { AUTH_TOKENS } from '../../application/tokens';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user';
import { PublicCustomerDto } from './dto/responses.dto';
import { MulterExceptionFilter } from './multer-exception.filter';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Any authenticated account may set its own avatar. Auth is enforced by the global
 * JwtAuthGuard (no @Roles needed); the uploaded file is stored via the StoragePort
 * and its public URL is persisted onto the caller's account.
 */
@ApiTags('Account')
@ApiBearerAuth()
@UseFilters(MulterExceptionFilter)
@Controller({ version: '1' })
export class AvatarController {
  constructor(
    @Inject(AUTH_TOKENS.Storage) private readonly storage: StoragePort,
    private readonly account: AccountService,
  ) {}

  @Post('auth/me/avatar')
  @ApiOperation({ summary: 'Upload the authenticated account avatar; returns the updated profile' })
  @ApiConsumes('multipart/form-data')
  @ApiOkResponse({ type: PublicCustomerDto })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<PublicCustomerDto> {
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
    const profile = await this.account.setAvatar(user.sub, url);
    return PublicCustomerDto.from(profile);
  }
}
