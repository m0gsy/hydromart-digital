import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Can, AuthenticatedUser, CurrentUser } from '@hydromart/platform';

import { SavedSegmentService } from '../application/services/saved-segment.service';
import { SaveSegmentDto, SavedSegmentDto } from './dto/saved-segment.dto';

// Design 21d — saved audience definitions. Same capability as campaigns: a segment IS the
// audience of a broadcast, so whoever may compose one may name it.
@ApiTags('Segments')
@ApiBearerAuth()
@Controller({ path: 'segments', version: '1' })
export class SavedSegmentController {
  constructor(private readonly segments: SavedSegmentService) {}

  @ApiOkResponse({ type: SavedSegmentDto, isArray: true })
  @Can('campaignRead')
  @Get()
  @ApiOperation({ summary: 'List saved segments, newest first (21d)' })
  async list(): Promise<SavedSegmentDto[]> {
    return (await this.segments.list()).map((s) => SavedSegmentDto.from(s));
  }

  @ApiOkResponse({ type: SavedSegmentDto })
  @Can('campaignWrite')
  @Post()
  @ApiOperation({ summary: 'Save a segment (upsert by name)' })
  async save(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SaveSegmentDto,
  ): Promise<SavedSegmentDto> {
    return SavedSegmentDto.from(await this.segments.save(user.sub, dto.name, dto.conditions));
  }

  @ApiOkResponse({ description: 'No content.' })
  @Can('campaignWrite')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a saved segment' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.segments.remove(id);
  }
}
