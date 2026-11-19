import {
  BadRequestException,
  Controller,
  HttpCode,
  PayloadTooLargeException,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiConsumes, ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { InternalAuthGuard } from '@hydromart/platform';

import { EmbedService } from '../application/embed.service';
import { UnreadableImageError } from '../domain/errors';
import { MAX_JPEG_BYTES } from '../http/body-limits';

export class EmbedResponseDto {
  @ApiProperty({ type: [Number], description: 'Unit-length 128-d SFace embedding' })
  vector!: number[];
  @ApiProperty({ example: 0.93, description: "The detector's score for the face used" })
  detScore!: number;
}

/** JPEG starts with FF D8 FF — checked before anything decodes it. */
const isJpeg = (b: Buffer) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/**
 * The one working route. hr-service only, over the service key: there is no user here.
 * The image is never logged (pino logs the request line, not the body) and never kept.
 */
@ApiTags('Face')
@Controller('internal')
export class EmbedController {
  constructor(private readonly embedder: EmbedService) {}

  @ApiOkResponse({ type: EmbedResponseDto })
  @ApiConsumes('image/jpeg')
  @UseGuards(InternalAuthGuard)
  @Post('embed')
  @HttpCode(200)
  @ApiOperation({ summary: 'Embed the face in a JPEG (422 NO_FACE when there is none)' })
  async embed(@Req() req: Request): Promise<EmbedResponseDto> {
    const body: unknown = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new BadRequestException('Kirim foto JPEG sebagai body (Content-Type: image/jpeg).');
    }
    // The parser already caps it; this holds even if the route is ever mounted without one.
    if (body.length > MAX_JPEG_BYTES) throw new PayloadTooLargeException('Foto lebih dari 2 MB.');
    if (!isJpeg(body)) throw new UnreadableImageError();
    return this.embedder.embed(body);
  }
}
