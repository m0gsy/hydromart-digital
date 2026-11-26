import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  PayloadTooLargeException,
  Post,
  Query,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { AuthenticatedUser, Can, CurrentUser, SNIFFED_MIME, sniffFileType } from '@hydromart/platform';

import {
  DepotOverview,
  VisitItemView,
  VisitService,
  VisitView,
} from '../application/services/visit.service';
import { VisitSummary } from '../application/ports/visit.repository';
import { Visit } from '../domain/visit';
import {
  AnswerVisitItemDto,
  CloseFollowUpDto,
  DepotOverviewResponseDto,
  FindingPageResponseDto,
  ListFindingsQueryDto,
  ListVisitsQueryDto,
  StartVisitDto,
  VisitPageResponseDto,
  VisitPhotoUploadResponseDto,
  VisitResponseDto,
  VisitItemResponseDto,
} from './dto/visit.dto';
import { MulterExceptionFilter } from './multer-exception.filter';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/**
 * HD-15B PR-4: supervisor visits. Supervisors over a depot conduct them (`visitConduct`); the
 * depot's Kepala, supervisors and head office read them (`visitRead`); Kepala and supervisors mark
 * a finding's follow-up done (`visitFollowUp`). The depot a caller may touch is the scope the
 * DepotScopeGuard already put on the request. Static paths are declared before `:id`.
 */
@ApiTags('Visits')
@ApiBearerAuth()
@Controller({ path: 'visits', version: '1' })
export class VisitController {
  constructor(private readonly visits: VisitService) {}

  @ApiOkResponse({ type: VisitResponseDto })
  @Post()
  @Can('visitConduct')
  @ApiOperation({ summary: 'Check in at a depot (GPS, inside its visit radius) and open a visit' })
  start(@Body() dto: StartVisitDto, @CurrentUser() user: AuthenticatedUser): Promise<Visit> {
    return this.visits.start(dto, user);
  }

  @ApiOkResponse({ type: VisitResponseDto, isArray: true })
  @Get('mine/open')
  @Can('visitConduct')
  @ApiOperation({ summary: "The caller's unfinished visits, to resume one" })
  mineOpen(@CurrentUser() user: AuthenticatedUser): Promise<Visit[]> {
    return this.visits.openOf(user.sub);
  }

  @ApiOkResponse({ type: DepotOverviewResponseDto, isArray: true })
  @Get('overview')
  @Can('visitRead')
  @ApiOperation({ summary: 'Per depot in scope: last visit, visits in 30 days, open and overdue findings' })
  overview(@CurrentUser() user: AuthenticatedUser): Promise<DepotOverview[]> {
    return this.visits.overview(user);
  }

  @ApiOkResponse({ type: FindingPageResponseDto })
  @Get('findings')
  @Can('visitRead')
  @ApiOperation({ summary: 'Findings in scope, by follow-up state (open, overdue, done)' })
  findings(@Query() q: ListFindingsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.visits.findings(user, q);
  }

  @ApiOkResponse({ type: VisitItemResponseDto })
  @Patch('findings/:itemId/follow-up')
  @Can('visitFollowUp')
  @ApiOperation({ summary: "Mark a finding's follow-up done, with a note (idempotent)" })
  closeFollowUp(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: CloseFollowUpDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<VisitItemView> {
    return this.visits.closeFollowUp(itemId, dto.note, user);
  }

  @ApiOkResponse({ type: VisitPageResponseDto })
  @Get()
  @Can('visitRead')
  @ApiOperation({ summary: 'Visits in scope, newest first' })
  list(
    @Query() q: ListVisitsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ items: VisitSummary[]; total: number; page: number; pageSize: number }> {
    return this.visits.list(user, q);
  }

  @ApiOkResponse({ type: VisitResponseDto })
  @Get(':id')
  @Can('visitRead')
  @ApiOperation({ summary: 'One visit with its answers and short-lived photo links' })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<VisitView> {
    return this.visits.get(id, user);
  }

  @ApiOkResponse({ type: VisitPhotoUploadResponseDto })
  @Post(':id/uploads')
  @Can('visitConduct')
  @UseFilters(MulterExceptionFilter)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PHOTO_BYTES } }))
  @ApiOperation({ summary: 'Upload a finding photo (jpg, png or webp, 5 MB) to an open visit' })
  async upload(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<{ key: string }> {
    if (!file) throw new BadRequestException('file is required');
    // The bytes decide, never the Content-Type the client typed: this bucket hands files back to
    // browsers, and a .html or .svg labelled image/jpeg would be a stored XSS. A PDF is not a photo.
    const sniffed = sniffFileType(file.buffer);
    const ext = sniffed && sniffed !== 'pdf' ? sniffed : undefined;
    if (!ext) throw new BadRequestException('unsupported file type (allowed: jpeg, png, webp)');
    if (file.size > MAX_PHOTO_BYTES) throw new PayloadTooLargeException('file exceeds 5MB');
    return this.visits.uploadPhoto(id, user, {
      body: file.buffer,
      contentType: SNIFFED_MIME[ext],
      ext,
    });
  }

  @ApiOkResponse({ type: VisitItemResponseDto })
  @Patch(':id/items/:itemId')
  @Can('visitConduct')
  @ApiOperation({ summary: 'Answer one checklist line: PASS, or a FINDING with note, photo and deadline' })
  answer(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: AnswerVisitItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<VisitItemView> {
    return this.visits.answer(id, itemId, dto, user);
  }

  @ApiOkResponse({ type: VisitResponseDto })
  @Post(':id/complete')
  @HttpCode(200)
  @Can('visitConduct')
  @ApiOperation({ summary: 'Finish a visit once every line is answered' })
  complete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<VisitView> {
    return this.visits.complete(id, user);
  }
}
