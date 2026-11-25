import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ApiBearerAuth, ApiConsumes, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, Can, CurrentUser, InternalAuthGuard, Public, SelfScoped } from '@hydromart/platform';

import {
  InForceItem,
  MAX_SOP_PDF_BYTES,
  SopDetailView,
  SopMineDetail,
  SopMineItem,
  SopService,
  SopSummaryView,
  UnreadPage,
  UploadedSopFile,
} from '../application/services/sop.service';
import {
  CreateSopDto,
  InForceQueryDto,
  SopAckResponseDto,
  SopDetailResponseDto,
  SopMineResponseDto,
  SopInForceResponseDto,
  SopSummaryResponseDto,
  SopUnreadResponseDto,
  SopUploadResponseDto,
  SopVersionDto,
  UnreadSopDto,
} from './dto/sop.dto';

/**
 * SOP documents and their versions (HD-16). Written by head office (`sopManage`), read by HR
 * and head office (`sopRead`). Static routes are declared before `:id`.
 */
@ApiTags('HR SOP')
@ApiBearerAuth()
@Controller({ path: 'sops', version: '1' })
export class SopController {
  constructor(private readonly sops: SopService) {}

  @ApiOkResponse({ type: SopUploadResponseDto })
  @Post('uploads')
  @Can('sopManage')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a SOP PDF (10 MB); returns the key to attach to a version' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_SOP_PDF_BYTES } }))
  upload(@UploadedFile() file?: UploadedSopFile): Promise<{ fileKey: string; fileName: string; sizeBytes: number }> {
    return this.sops.upload(file);
  }

  @ApiOkResponse({ type: SopDetailResponseDto })
  @Post()
  @Can('sopManage')
  @ApiOperation({ summary: 'Create a SOP with its first version' })
  create(@Body() dto: CreateSopDto, @CurrentUser() user: AuthenticatedUser): Promise<SopDetailView> {
    return this.sops.create(user, dto.title, dto);
  }

  @ApiOkResponse({ type: SopDetailResponseDto })
  @Post(':id/versions')
  @Can('sopManage')
  @ApiOperation({ summary: 'Publish a new version of a SOP (the old ones stay as they were)' })
  addVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SopVersionDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SopDetailView> {
    return this.sops.addVersion(user, id, dto);
  }

  @ApiOkResponse({ type: SopSummaryResponseDto, isArray: true })
  @Get()
  @Can('sopRead')
  @ApiOperation({ summary: 'Every SOP with the version in force and how many have read it' })
  list(): Promise<SopSummaryView[]> {
    return this.sops.list();
  }

  /** Called by depot-service when a supervisor visit snapshots the SOP behind a checklist item. */
  @ApiOkResponse({ type: SopInForceResponseDto })
  @Get('internal/in-force')
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @ApiOperation({ summary: 'The version of each given SOP in force for a depot today (internal)' })
  inForce(@Query() q: InForceQueryDto): Promise<{ items: InForceItem[] }> {
    return this.sops.inForceFor(q.depotId, q.ids);
  }

  @ApiOkResponse({ type: SopUnreadResponseDto })
  @Get('versions/:versionId/unread')
  @Can('sopRead')
  @ApiOperation({ summary: 'Who has not yet read a version, newest page first, with counts per depot' })
  unread(
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Query() q: UnreadSopDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UnreadPage> {
    return this.sops.unread(user, versionId, q);
  }

  @ApiOkResponse({ type: SopDetailResponseDto })
  @Get(':id')
  @Can('sopRead')
  @ApiOperation({ summary: 'One SOP with its whole version history' })
  getById(@Param('id', ParseUUIDPipe) id: string): Promise<SopDetailView> {
    return this.sops.getById(id);
  }
}

/**
 * What an employee sees of the SOPs (HD-16 PR-2). Registered BEFORE SopController in the module, so
 * `me` is not read as a SOP id. No capability: any account linked to an employee, scoped by audience.
 */
@ApiTags('HR SOP')
@ApiBearerAuth()
@Controller({ path: 'sops', version: '1' })
export class SelfSopController {
  constructor(private readonly sops: SopService) {}

  @ApiOkResponse({ type: SopMineResponseDto, isArray: true })
  @SelfScoped()
  @Get('me')
  @ApiOperation({ summary: 'The SOP versions that bind me today, with whether I have read each' })
  mine(@CurrentUser() user: AuthenticatedUser): Promise<SopMineItem[]> {
    return this.sops.mine(user);
  }

  @ApiOkResponse({ type: SopMineResponseDto })
  @SelfScoped()
  @Get('versions/:versionId')
  @ApiOperation({ summary: 'One version addressed to me, with its text' })
  version(
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SopMineDetail> {
    return this.sops.versionForSelf(user, versionId);
  }

  @ApiOkResponse({
    description: 'The PDF bytes.',
    content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
  })
  @SelfScoped()
  @Get('versions/:versionId/file')
  @Header('Cache-Control', 'no-store, private')
  @ApiOperation({ summary: 'The version PDF (authenticated; never cached)' })
  async file(
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { body, fileName } = await this.sops.fileForSelf(user, versionId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
    return new StreamableFile(body);
  }

  @ApiOkResponse({ type: SopAckResponseDto })
  @SelfScoped()
  @Post('versions/:versionId/ack')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark a version read (idempotent)' })
  ack(
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ ackedAt: Date }> {
    return this.sops.ack(user, versionId);
  }
}
