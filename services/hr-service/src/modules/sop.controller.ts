import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, Can, CurrentUser, InternalAuthGuard, Public } from '@hydromart/platform';

import {
  InForceItem,
  MAX_SOP_PDF_BYTES,
  SopDetailView,
  SopService,
  SopSummaryView,
  UnreadPage,
  UploadedSopFile,
} from '../application/services/sop.service';
import {
  CreateSopDto,
  InForceQueryDto,
  SopDetailResponseDto,
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
