import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { Can, AuthenticatedUser, CurrentUser, InternalAuthGuard, Public } from '@hydromart/platform';
import { UseGuards } from '@nestjs/common';

import {
  DocumentService,
  DocumentView,
  MAX_DOCUMENT_BYTES,
  UploadedDocumentFile,
} from '../application/services/document.service';
import { RetentionReportDto } from './dto/employee.dto';
import { ListDocumentDto, UploadDocumentDto } from './dto/document.dto';
import { EmployeeDocumentResponseDto, Purge2ResponseDto } from './dto/responses.generated.dto';

/**
 * Employee personal files. Read hrView, write hrAdmin — a depot operator has no business in
 * anyone's KTP, and the depot check runs through the owning employee either way.
 */
@ApiTags('HR Documents')
@ApiBearerAuth()
@Controller({ path: 'employee-documents', version: '1' })
export class DocumentController {
  constructor(private readonly documents: DocumentService) {}

  @ApiOkResponse({ type: EmployeeDocumentResponseDto, isArray: true })
  @Get()
  @Can('hrView')
  @ApiOperation({ summary: 'List an employee’s documents (newest version of each type first)' })
  list(@Query() q: ListDocumentDto, @CurrentUser() user: AuthenticatedUser): Promise<DocumentView[]> {
    return this.documents.list(user, q.employeeId);
  }

  @ApiOkResponse({ type: EmployeeDocumentResponseDto })
  @Get(':id')
  @Can('hrView')
  @ApiOperation({ summary: 'One document, including a superseded version' })
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser): Promise<DocumentView> {
    return this.documents.get(user, id);
  }

  /**
   * The file itself (SEC-01).
   *
   * It used to be an unsigned, permanent object-storage URL handed to the browser in
   * `fileUrl`: a KTP scan or a payslip that anybody who had ever seen the link could open
   * forever, signed out, from anywhere. The bytes come through here now, behind `hrView`
   * and the owning employee's depot check, and are told not to be cached anywhere.
   */
  @Get(':id/file')
  @Can('hrView')
  @Header('Cache-Control', 'no-store, private')
  @ApiOperation({ summary: 'Download the document file (authenticated; never cached)' })
  async file(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { document, body, contentType } = await this.documents.download(user, id);
    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${document.type}-v${document.version}"`,
    );
    return new StreamableFile(body);
  }

  @ApiOkResponse({ type: EmployeeDocumentResponseDto })
  @Post()
  @Can('hrAdmin')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a document; an existing one of the same type is superseded' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES } }))
  upload(
    @Body() dto: UploadDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
    // Typed locally rather than via Express.Multer.File: this is the whole surface the
    // service uses, and it keeps @types/multer out of the dependency list.
    @UploadedFile() file?: UploadedDocumentFile,
  ): Promise<DocumentView> {
    return this.documents.upload(user, dto, file);
  }

  /**
   * Retention purge for admin-service's engine (UU 27/2022, same internal-key pattern as the
   * employee retention routes). Deletes the stored object AND the row — a KTP left in the
   * bucket is not erased.
   */
  @ApiOkResponse({ type: Purge2ResponseDto })
  @Post('internal/retention-purge')
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @ApiOperation({ summary: 'Delete documents of departed staff past the cutoff (internal)' })
  purge(@Body() dto: RetentionReportDto): Promise<{ deleted: number; failed: number }> {
    return this.documents.purgeRetentionEligible(new Date(dto.cutoff));
  }
}
