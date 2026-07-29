import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { CAPABILITIES } from '@hydromart/access';
import { AuthenticatedUser, CurrentUser, InternalAuthGuard, Public, Roles } from '@hydromart/platform';
import { UseGuards } from '@nestjs/common';

import {
  DocumentService,
  MAX_DOCUMENT_BYTES,
  UploadedDocumentFile,
} from '../application/services/document.service';
import { RetentionReportDto } from './dto/employee.dto';
import { ListDocumentDto, UploadDocumentDto } from './dto/document.dto';

/**
 * Employee personal files. Read hrView, write hrAdmin — a depot operator has no business in
 * anyone's KTP, and the depot check runs through the owning employee either way.
 */
@ApiTags('HR Documents')
@ApiBearerAuth()
@Controller({ path: 'employee-documents', version: '1' })
export class DocumentController {
  constructor(private readonly documents: DocumentService) {}

  @Get()
  @Roles(...CAPABILITIES.hrView)
  @ApiOperation({ summary: 'List an employee’s documents (newest version of each type first)' })
  list(@Query() q: ListDocumentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.documents.list(user, q.employeeId);
  }

  @Get(':id')
  @Roles(...CAPABILITIES.hrView)
  @ApiOperation({ summary: 'One document, including a superseded version' })
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.documents.get(user, id);
  }

  @Post()
  @Roles(...CAPABILITIES.hrAdmin)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a document; an existing one of the same type is superseded' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES } }))
  upload(
    @Body() dto: UploadDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
    // Typed locally rather than via Express.Multer.File: this is the whole surface the
    // service uses, and it keeps @types/multer out of the dependency list.
    @UploadedFile() file?: UploadedDocumentFile,
  ) {
    return this.documents.upload(user, dto, file);
  }

  /**
   * Retention purge for admin-service's engine (UU 27/2022, same internal-key pattern as the
   * employee retention routes). Deletes the stored object AND the row — a KTP left in the
   * bucket is not erased.
   */
  @Post('internal/retention-purge')
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @ApiOperation({ summary: 'Delete documents of departed staff past the cutoff (internal)' })
  purge(@Body() dto: RetentionReportDto): Promise<{ deleted: number; failed: number }> {
    return this.documents.purgeRetentionEligible(new Date(dto.cutoff));
  }
}
