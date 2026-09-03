import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { AuditMutationsInterceptor, Can, InternalAuthGuard, Public } from '@hydromart/platform';

import { FraudFlagService } from '../application/services/fraud-flag.service';
import { FraudScanResult, FraudScanService } from '../application/services/fraud-scan.service';
import {
  FraudFlagDto,
  FraudFlagQueryDto,
  FraudScanResultDto,
  IngestFraudFlagDto,
} from './dto/fraud-flag.dto';

// Design 15b — fraud & risk queue. HEAD_OFFICE + SUPER_ADMIN read (highest-score-then-newest,
// filter level/status) + review / block / clear. Ingest is service-to-service (internal key):
// a scoring job inserts flags; the score/level/signals it supplies are stored verbatim.
@ApiTags('Fraud & risk')
@ApiBearerAuth()
// CA-2-67: every write below reaches the audit trail. See AuditMutationsInterceptor.
@UseInterceptors(AuditMutationsInterceptor)
@Controller({ path: 'fraud-flags', version: '1' })
export class FraudFlagsController {
  constructor(
    private readonly fraud: FraudFlagService,
    private readonly scanner: FraudScanService,
  ) {}

  @ApiOkResponse({ type: FraudFlagDto, isArray: true })
  @Can('fraudReview')
  @Get()
  @ApiOperation({ summary: 'List fraud flags (15b, highest score first, filterable)' })
  async list(@Query() query: FraudFlagQueryDto): Promise<FraudFlagDto[]> {
    const rows = await this.fraud.list({ level: query.level, status: query.status });
    return rows.map(FraudFlagDto.from);
  }

  @ApiOkResponse({ type: FraudFlagDto })
  @Can('fraudReview')
  @Post(':id/review')
  @ApiOperation({ summary: 'Mark a flag reviewed' })
  async review(@Param('id') id: string): Promise<FraudFlagDto> {
    return FraudFlagDto.from(await this.fraud.review(id));
  }

  @ApiOkResponse({ type: FraudFlagDto })
  @Can('fraudReview')
  @Post(':id/block')
  @ApiOperation({ summary: 'Block the flagged entity' })
  async block(@Param('id') id: string): Promise<FraudFlagDto> {
    return FraudFlagDto.from(await this.fraud.block(id));
  }

  @ApiOkResponse({ type: FraudFlagDto })
  @Can('fraudReview')
  @Post(':id/clear')
  @ApiOperation({ summary: 'Clear the flag (no fraud)' })
  async clear(@Param('id') id: string): Promise<FraudFlagDto> {
    return FraudFlagDto.from(await this.fraud.clear(id));
  }

  /*
   * The scoring job itself (15b), fired by the scheduler — which is why it is internal-key
   * and not a bearer route.
   *
   * Until this shipped nothing anywhere raised a flag, so `/hq/fraud` could review, block
   * and clear a queue that only ever held rows put there by hand. Declared before the
   * ingest below; both are static so the order is only for reading.
   */
  @ApiOkResponse({ type: FraudScanResultDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal/scan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run the repeated-refund fraud scan (internal service auth)' })
  async scan(): Promise<FraudScanResult> {
    return this.scanner.run();
  }

  // Service-to-service ingest: a scoring job records a risk flag. @Public() bypasses the JWT
  // guard; InternalAuthGuard (shared key) is then the sole, fail-closed auth.
  @ApiOkResponse({ type: FraudFlagDto })
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
