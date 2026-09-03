import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuditMutationsInterceptor, Can } from '@hydromart/platform';

import { ApiKeyEnvironment } from '../domain/api-key-environment';
import { ApiKeyService } from '../application/services/api-key.service';
import { ApiKeyDto, CreateApiKeyDto, CreatedApiKeyDto } from './dto/api-key.dto';

// Design 13d — service API credentials. SUPER_ADMIN only. Create/rotate return the full
// secret exactly once; the list only ever shows the display-safe prefix.
//
// H-30: these keys authenticate. ApiKeyGuard verifies a presented `x-api-key` against the
// stored sha256, refuses revoked keys, enforces per-route scopes and stamps `lastUsedAt`.
// The surface they open is /api/v1/partner/* — a partner's own webhook deliveries.
@ApiTags('API keys')
@ApiBearerAuth()
@Can('platformAdmin')
// CA-2-67: every write below reaches the audit trail. See AuditMutationsInterceptor.
@UseInterceptors(AuditMutationsInterceptor)
@Controller({ path: 'api-keys', version: '1' })
export class ApiKeysController {
  constructor(private readonly keys: ApiKeyService) {}

  @ApiOkResponse({ type: ApiKeyDto, isArray: true })
  @Get()
  @ApiOperation({
    summary: 'List service API keys (13d)',
    description:
      'Keys authenticate /api/v1/partner/* via the x-api-key header; scopes are enforced ' +
      'per route (webhooks:read, webhooks:write).',
  })
  async list(): Promise<ApiKeyDto[]> {
    return (await this.keys.list()).map((k) => ApiKeyDto.from(k));
  }

  @ApiOkResponse({ type: CreatedApiKeyDto })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an API key — returns the full secret once' })
  async create(@Body() dto: CreateApiKeyDto): Promise<CreatedApiKeyDto> {
    return CreatedApiKeyDto.fromSecret(
      await this.keys.create({
        name: dto.name,
        scopes: dto.scopes,
        environment: dto.environment ?? ApiKeyEnvironment.PROD,
      }),
    );
  }

  @ApiOkResponse({ type: CreatedApiKeyDto })
  @Post(':id/rotate')
  @ApiOperation({ summary: 'Rotate an API key — returns the new secret once' })
  async rotate(@Param('id') id: string): Promise<CreatedApiKeyDto> {
    return CreatedApiKeyDto.fromSecret(await this.keys.rotate(id));
  }

  @ApiOkResponse({ type: ApiKeyDto })
  @Delete(':id')
  @ApiOperation({ summary: 'Revoke an API key' })
  async revoke(@Param('id') id: string): Promise<ApiKeyDto> {
    return ApiKeyDto.from(await this.keys.revoke(id));
  }
}
