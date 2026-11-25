import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, Can, CurrentUser } from '@hydromart/platform';

import {
  VisitTemplateService,
  VisitTemplateView,
} from '../application/services/visit-template.service';
import { VisitTemplate } from '../domain/visit-template';
import {
  CreateVisitTemplateDto,
  UpdateVisitTemplateDto,
  VisitTemplateConductQueryDto,
  VisitTemplateResponseDto,
} from './dto/visit-template.dto';

/**
 * HD-15B: the checklist templates behind a supervisor visit. Head office writes
 * (`visitTemplateManage`); a supervisor reads the active ones (`visitConduct`). Two read lists
 * because the two roles never overlap and one route can carry only one capability.
 */
@ApiTags('Visit templates')
@ApiBearerAuth()
@Controller({ path: 'visit-templates', version: '1' })
export class VisitTemplateController {
  constructor(private readonly templates: VisitTemplateService) {}

  @ApiOkResponse({ type: VisitTemplateResponseDto, isArray: true })
  @Get()
  @Can('visitConduct')
  @ApiOperation({ summary: 'Active visit templates, to start a visit from' })
  listActive(): Promise<VisitTemplate[]> {
    return this.templates.list(false);
  }

  // Declared before ':id' so "manage" is never read as an id.
  @ApiOkResponse({ type: VisitTemplateResponseDto, isArray: true })
  @Get('manage')
  @Can('visitTemplateManage')
  @ApiOperation({ summary: 'Every visit template, retired ones included (head office)' })
  listAll(): Promise<VisitTemplate[]> {
    return this.templates.list(true);
  }

  @ApiOkResponse({ type: VisitTemplateResponseDto })
  @Get(':id')
  @Can('visitConduct')
  @ApiOperation({
    summary: 'One active template; with depotId each item carries the SOP version in force there',
  })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: VisitTemplateConductQueryDto,
  ): Promise<VisitTemplateView> {
    return this.templates.getForConductor(id, query.depotId);
  }

  @ApiOkResponse({ type: VisitTemplateResponseDto })
  @Post()
  @Can('visitTemplateManage')
  @ApiOperation({ summary: 'Create a visit template' })
  create(
    @Body() dto: CreateVisitTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<VisitTemplate> {
    return this.templates.create({ name: dto.name, items: dto.items }, user.sub);
  }

  @ApiOkResponse({ type: VisitTemplateResponseDto })
  @Put(':id')
  @Can('visitTemplateManage')
  @ApiOperation({
    summary: 'Replace a template (name, active flag and the whole checklist) in one transaction',
  })
  replace(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVisitTemplateDto,
  ): Promise<VisitTemplate> {
    return this.templates.replace(
      id,
      { name: dto.name, active: dto.active, items: dto.items },
      dto.seenUpdatedAt,
    );
  }
}
