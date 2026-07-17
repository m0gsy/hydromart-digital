import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public, Role, Roles } from '@hydromart/platform';

import { FraudFlagService } from '../application/services/fraud-flag.service';
import { FraudFlagDto, FraudFlagQueryDto, IngestFraudFlagDto } from './dto/fraud-flag.dto';

// Design 15b — fraud & risk queue. HEAD_OFFICE + SUPER_ADMIN read (highest-score-then-newest,
// filter level/status) + review / block / clear. Ingest is service-to-service (internal key):
// a scoring job inserts flags; the score/level/signals it supplies are stored verbatim.
@ApiTags('Fraud & risk')
@ApiBearerAuth()
@Controller({ path: 'fraud-flags', version: '1' })
export class FraudFlagsController {
  constructor(private readonly fraud: FraudFlagService) {}

  @Roles(Role.HEAD_OFFICE, Role.SUPER_ADMIN)
  @Get()
  @ApiOperation({ summary: 'List fraud flags (15b, highest score first, filterable)' })
  async list(@Query() query: FraudFlagQueryDto): Promise<FraudFlagDto[]> {
    const rows = await this.fraud.list({ level: query.level, status: query.status });
    return rows.map(FraudFlagDto.from);
  }

  @Roles(Role.HEAD_OFFICE, Role.SUPER_ADMIN)
  @Post(':id/review')
  @ApiOperation({ summary: 'Mark a flag reviewed' })
  async review(@Param('id') id: string): Promise<FraudFlagDto> {
    return FraudFlagDto.from(await this.fraud.review(id));
  }

  @Roles(Role.HEAD_OFFICE, Role.SUPER_ADMIN)
  @Post(':id/block')
  @ApiOperation({ summary: 'Block the flagged entity' })
  async block(@Param('id') id: string): Promise<FraudFlagDto> {
    return FraudFlagDto.from(await this.fraud.block(id));
  }

  @Roles(Role.HEAD_OFFICE, Role.SUPER_ADMIN)
  @Post(':id/clear')
  @ApiOperation({ summary: 'Clear the flag (no fraud)' })
  async clear(@Param('id') id: string): Promise<FraudFlagDto> {
    return FraudFlagDto.from(await this.fraud.clear(id));
  }

  // Service-to-service ingest: a scoring job records a risk flag. @Public() bypasses the JWT
  // guard; InternalAuthGuard (shared key) is then the sole, fail-closed auth.
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record a fraud flag (internal service auth)' })
  async ingest(@Body() dto: IngestFraudFlagDto): Promise<FraudFlagDto> {
    return FraudFlagDto.from(
      await this.fraud.ingest({
        entityType: dto.entityType,
        entityRef: dto.entityRef,
        score: dto.score,
        level: dto.level,
        signals: dto.signals,
        status: dto.status,
      }),
    );
  }
}
