import {
  BadRequestException,
  Controller,
  Get,
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
import { StoragePort, avatarKeyFromUrl } from '../../application/ports/storage.port';
import { AUTH_TOKENS } from '../../application/tokens';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user';
import { AvatarLinkResponseDto, PublicCustomerDto } from './dto/responses.dto';
import { MulterExceptionFilter } from './multer-exception.filter';

const MAX_BYTES = 5 * 1024 * 1024;
/** AUTH-1: long enough to render the profile screen, short enough not to outlive it. */
const AVATAR_LINK_TTL_SECONDS = 15 * 60;
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
    const previous = (await this.account.getProfile(user.sub)).avatarUrl;
    const profile = await this.account.setAvatar(user.sub, url);
    // AUTH-2: the photo it replaces has nothing pointing at it any more. A bucket refusing
    // the delete is logged; the new avatar is already saved and that is what was asked.
    const oldKey = previous !== url ? avatarKeyFromUrl(previous) : null;
    if (oldKey) {
      await this.storage
        .remove(oldKey)
        .catch((error: Error) =>
          this.logger.error(`Old avatar ${oldKey} left behind: ${error.message}`),
        );
    }
    return PublicCustomerDto.from(profile);
  }

  /*
   * AUTH-1 — the caller's own avatar as a link that expires.
   *
   * Same shape as delivery's `proof-links` (CA-4-49): a JSON route fetched through the
   * app's authenticated client, because an `<img src>` redirect would lose the session
   * cookie across origins. The signature authorises the object store, so the image request
   * itself needs no credentials.
   */
  @Get('auth/me/avatar-link')
  @ApiOperation({ summary: "Time-limited link to the authenticated account's avatar" })
  @ApiOkResponse({ type: AvatarLinkResponseDto })
  async avatarLink(@CurrentUser() user: AuthenticatedUser): Promise<AvatarLinkResponseDto> {
    const key = avatarKeyFromUrl((await this.account.getProfile(user.sub)).avatarUrl);
    return {
      avatarUrl: key ? await this.storage.signedUrl(key, AVATAR_LINK_TTL_SECONDS) : null,
    };
  }
}
