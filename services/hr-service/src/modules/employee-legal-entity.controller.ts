import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, Can, CurrentUser } from '@hydromart/platform';

import { AssignedEmployee } from '../application/ports/employee-legal-entity.repository';
import { EmployeeLegalEntityService } from '../application/services/employee-legal-entity.service';
import { EmployeeLegalEntityHistory } from '../domain/legal-entity';
import {
  AssignEmployeeLegalEntityDto,
  AssignedEmployeeResponseDto,
  EmployeeLegalEntityHistoryResponseDto,
} from './dto/employee-legal-entity.dto';

/**
 * HD-5 — the employee half of /hq/legal-entities: which legal entity employs each person, by
 * date. Head office only (`legalEntityAdmin`); the HR audit interceptor trails every write.
 */
@ApiTags('HR Legal entities')
@ApiBearerAuth()
@Can('legalEntityAdmin')
@Controller({ path: 'employee-legal-entities', version: '1' })
export class EmployeeLegalEntityController {
  constructor(private readonly legalEntities: EmployeeLegalEntityService) {}

  @ApiOkResponse({ type: EmployeeLegalEntityHistoryResponseDto, isArray: true })
  @Get()
  @ApiOperation({ summary: 'Every employee with their dated legal-entity points, newest first' })
  histories(): Promise<EmployeeLegalEntityHistory[]> {
    return this.legalEntities.histories();
  }

  @ApiOkResponse({ type: AssignedEmployeeResponseDto, isArray: true })
  @Post()
  @ApiOperation({ summary: 'From a date, these employees work for this legal entity (same date = a correction)' })
  assign(
    @Body() dto: AssignEmployeeLegalEntityDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AssignedEmployee[]> {
    return this.legalEntities.assign(dto, user.sub);
  }

  @ApiOkResponse({ description: 'No content.' })
  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Take back one dated legal-entity point of an employee' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.legalEntities.remove(id, user.sub);
  }
}
