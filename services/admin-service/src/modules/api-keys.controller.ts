import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Role, Roles } from '@hydromart/platform';

import { ApiKeyEnvironment } from '../domain/api-key-environment';
import { ApiKeyService } from '../application/services/api-key.service';
import { ApiKeyDto, CreateApiKeyDto, CreatedApiKeyDto } from './dto/api-key.dto';

// Design 13d — service API credentials. SUPER_ADMIN only. Create/rotate return the full
// secret exactly once; the list only ever shows the display-safe prefix.
//
// H-30: this is a REGISTRY, not an authentication mechanism. No route in any service
// accepts one of these keys, nothing checks `scopes`, and `lastUsedAt` is never written —
// a key handed to a partner today authenticates nothing. Building the guard is easy;
// deciding which public API it protects is the part nobody has asked for yet, so the
// surface says what it is instead of implying an integration that does not exist.
@ApiTags('API keys')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN)
@Controller({ path: 'api-keys', version: '1' })
export class ApiKeysController {
  constructor(private readonly keys: ApiKeyService) {}

  @Get()
  @ApiOperation({
    summary: 'List service API keys (13d)',
    description: 'A registry only — no endpoint accepts these keys and no scope is enforced.',
  })
  async list(): Promise<ApiKeyDto[]> {
    return (await this.keys.list()).map((k) => ApiKeyDto.from(k));
  }

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

  @Post(':id/rotate')
  @ApiOperation({ summary: 'Rotate an API key — returns the new secret once' })
  async rotate(@Param('id') id: string): Promise<CreatedApiKeyDto> {
    return CreatedApiKeyDto.fromSecret(await this.keys.rotate(id));
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Revoke an API key' })
  async revoke(@Param('id') id: string): Promise<ApiKeyDto> {
    return ApiKeyDto.from(await this.keys.revoke(id));
  }
}
