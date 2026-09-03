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

import { SNIFFED_MIME, sniffFileType } from '@hydromart/platform';

import { AccountService } from '../../application/services/account.service';
import { StoragePort } from '../../application/ports/storage.port';
import { AUTH_TOKENS } from '../../application/tokens';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user';
import { PublicCustomerDto } from './dto/responses.dto';
import { MulterExceptionFilter } from './multer-exception.filter';

const MAX_BYTES = 5 * 1024 * 1024;
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
  private readonly logger = new Logger(AvatarController.name);

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
    // M1-10: object storage being unreachable or misconfigured is an infrastructure
    // fault, not a malformed request — it used to escape as a bare 500 with nothing
    // logged, which is what made this unreproducible. Answer 503 (retryable) and log
    // the real cause so ops can see WHICH bucket/endpoint failed.
    let url: string;
    try {
      ({ url } = await this.storage.put({
        body: file.buffer,
        contentType: SNIFFED_MIME[ext],
        ext,
      }));
    } catch (error) {
      this.logger.error(`Avatar upload failed for ${user.sub}: ${(error as Error).message}`);
      throw new ServiceUnavailableException(
        'Penyimpanan foto sedang tidak tersedia. Coba lagi sebentar lagi.',
      );
    }
    const profile = await this.account.setAvatar(user.sub, url);
    return PublicCustomerDto.from(profile);
  }
}
