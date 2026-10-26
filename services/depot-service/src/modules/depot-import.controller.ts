import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Can,
  CurrentUser,
  AuthenticatedUser,
  ImportSummary,
  assertCapability,
} from '@hydromart/platform';

import { DepotImportService } from '../application/services/depot-import.service';
import { ImportDepotsDto } from './dto/depot.dto';
import { ImportResponseDto } from './dto/responses.generated.dto';

@ApiTags('Depots')
@Controller({ path: 'depots/import', version: '1' })
export class DepotImportController {
  constructor(private readonly imports: DepotImportService) {}

  // Creating depots is `depotLifecycle`. Changing existing ones is `depotAdmin` everywhere
  // else, so `upsert` asks for it too; otherwise HQ could edit any depot's bank account
  // and QRIS by uploading a spreadsheet, which the PATCH route deliberately does not allow.
  @ApiOkResponse({ type: ImportResponseDto })
  @ApiBearerAuth()
  @Can('depotLifecycle')
  @Post()
  @ApiOperation({ summary: 'Bulk create (and optionally update) depots from the CSV wizard' })
  import(
    @Body() dto: ImportDepotsDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ImportSummary> {
    if (dto.mode === 'upsert') assertCapability(user, 'depotAdmin');
    return this.imports.import(dto.mode, dto.rows, user);
  }
}
