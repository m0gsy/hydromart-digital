import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  assertDepotAccess,
  AuditMutationsInterceptor,
  AuthenticatedUser,
  Can,
  CurrentUser,
} from '@hydromart/platform';

import { QualityHoldService } from '../application/services/quality-hold.service';
import { LabTest, Permit, QualityHold } from '../domain/quality-hold';
import { CreateLabTestDto, CreatePermitDto, EndQualityHoldDto, StartQualityHoldDto } from './dto/quality-hold.dto';

/**
 * HD-14: a depot's quality hold, lab tests and permits. Staff routes only: no @ExternalAccess, so
 * neither the AI token nor the machine token can start or end a hold or record a test. The depot
 * a Kepala may touch is fenced twice: the DepotScopeGuard (the `:depotId` param) and the explicit
 * assertion in each handler.
 */
@ApiTags('Quality hold')
@ApiBearerAuth()
@Controller({ path: 'depots/:depotId', version: '1' })
export class QualityHoldController {
  constructor(private readonly holds: QualityHoldService) {}

  @ApiOkResponse({ description: 'The hold, ACTIVE. 409 when the depot already has one.' })
  @Can('depotQualityHoldStart')
  @UseInterceptors(AuditMutationsInterceptor)
  @Post('quality-hold')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Stop selling at a depot (quality hold)' })
  start(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Body() dto: StartQualityHoldDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QualityHold> {
    assertDepotAccess(user, depotId);
    return this.holds.start(depotId, dto, user.sub);
  }

  @ApiOkResponse({ description: 'The hold, ENDED. 422 unless the named test is a PASS of this depot from the hold start day on.' })
  @Can('depotQualityHoldEnd')
  @UseInterceptors(AuditMutationsInterceptor)
  @Post('quality-hold/end')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resume selling: end the hold, naming the PASS retest' })
  end(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Body() dto: EndQualityHoldDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QualityHold> {
    assertDepotAccess(user, depotId);
    return this.holds.end(depotId, dto.retestId, user.sub);
  }

  @ApiOkResponse({ description: 'Every hold of the depot, newest first.' })
  @Can('depotCompliance')
  @Get('quality-hold')
  @ApiOperation({ summary: "A depot's quality hold history" })
  history(@Param('depotId', ParseUUIDPipe) depotId: string, @CurrentUser() user: AuthenticatedUser): Promise<QualityHold[]> {
    assertDepotAccess(user, depotId);
    return this.holds.history(depotId);
  }

  @ApiOkResponse({ description: 'The recorded lab test.' })
  @Can('depotCompliance')
  @UseInterceptors(AuditMutationsInterceptor)
  @Post('lab-tests')
  @ApiOperation({ summary: 'Record a lab test result' })
  addLabTest(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Body() dto: CreateLabTestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LabTest> {
    assertDepotAccess(user, depotId);
    return this.holds.addLabTest({ depotId, ...dto }, user.sub);
  }

  @ApiOkResponse({ description: "A depot's lab tests, newest first." })
  @Can('depotCompliance')
  @Get('lab-tests')
  @ApiOperation({ summary: "A depot's lab tests" })
  labTests(@Param('depotId', ParseUUIDPipe) depotId: string, @CurrentUser() user: AuthenticatedUser): Promise<LabTest[]> {
    assertDepotAccess(user, depotId);
    return this.holds.listLabTests(depotId);
  }

  @ApiOkResponse({ description: 'The recorded permit.' })
  @Can('depotCompliance')
  @UseInterceptors(AuditMutationsInterceptor)
  @Post('permits')
  @ApiOperation({ summary: 'Record a permit and its validity' })
  addPermit(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Body() dto: CreatePermitDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Permit> {
    assertDepotAccess(user, depotId);
    return this.holds.addPermit({ depotId, ...dto }, user.sub);
  }

  @ApiOkResponse({ description: "A depot's permits, latest validity first." })
  @Can('depotCompliance')
  @Get('permits')
  @ApiOperation({ summary: "A depot's permits" })
  permits(@Param('depotId', ParseUUIDPipe) depotId: string, @CurrentUser() user: AuthenticatedUser): Promise<Permit[]> {
    assertDepotAccess(user, depotId);
    return this.holds.listPermits(depotId);
  }
}
