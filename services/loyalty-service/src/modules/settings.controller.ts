import { Body, Controller, Delete, Get, HttpCode, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { assertCapability, Can, AuthenticatedUser, CurrentUser } from '@hydromart/platform';

import { SettingsService } from '../application/services/settings.service';
import { PutSettingDto, ResetSettingDto } from './dto/settings.dto';
import { SettingDef, TIER_SETTING_KEYS } from '../config/setting-defs';
import { SchemaResponseDto } from './dto/responses.generated.dto';

/**
 * LOY-5: the tunables a depot may NOT set for itself, at any scope.
 *
 * A point is one currency across the whole network: earned at one depot, spent at another,
 * and counted towards a tier that is the customer's card everywhere. So a depot-scoped
 * MANAGER halving `earnRateRupiah` at their own depot does not make a local decision — it
 * mints network money at a discount, and every other depot honours it. The same is true of
 * how long a point lives and of the point count that buys a tier.
 *
 * `adjustMaxPoints` is here for a blunter reason: it is the ceiling on what a MANAGER may
 * mint by hand (LOY-2), and a ceiling its own subject can raise is not a ceiling.
 *
 * What a depot DOES still set for itself is the tier discount percentage — that is money out
 * of its own till at its own counter, which is exactly the kind of decision a depot owns.
 */
const HQ_ONLY_KEYS = new Set([
  'earnRateRupiah',
  'pointExpiryMonths',
  'adjustMaxPoints',
  ...Object.values(TIER_SETTING_KEYS).map((k) => k.threshold),
]);

/** Per-depot business-tunable settings: schema/effective read, GLOBAL/DEPOT put+reset. */
@ApiTags('Settings')
@ApiBearerAuth()
@Can('depotAdmin')
@Controller({ path: 'settings', version: '1' })
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /**
   * GLOBAL has always needed `settingsGlobal`. LOY-5 adds the second rule: the keys that
   * mint a network-wide currency need it at DEPOT scope too.
   */
  private assertMayWrite(user: AuthenticatedUser, scope: 'GLOBAL' | 'DEPOT', key: string): void {
    if (scope === 'GLOBAL' || HQ_ONLY_KEYS.has(key)) {
      assertCapability(user, 'settingsGlobal');
    }
  }

  @ApiOkResponse({ type: SchemaResponseDto })
  @Get('schema')
  // CA-2-19/CA-2-11: reading the tunables is not editing a depot. The class gate is
  // `depotAdmin` (MANAGER + SUPER_ADMIN), which shut head office, the director and finance
  // out of every number this returns — so /hq/scorecard was a full-page error for the two
  // roles its rail offers it to. Writes below keep `depotAdmin`.
  @Can('settingsRead')
  @ApiOperation({ summary: 'Setting defs + effective values for an optional depot' })
  schema(
    @Query('depotId') depotId?: string,
  ): Promise<{ defs: SettingDef[]; effective: Record<string, number | string> }> {
    return this.settings.schema(depotId ?? null);
  }

  @ApiOkResponse({ description: 'No content.' })
  @Put()
  @HttpCode(204)
  @ApiOperation({ summary: 'Set a GLOBAL or DEPOT override' })
  async put(@Body() dto: PutSettingDto, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    this.assertMayWrite(user, dto.scope, dto.key);
    await this.settings.put({
      scope: dto.scope,
      depotId: dto.depotId ?? null,
      key: dto.key,
      value: dto.value,
      updatedBy: user.sub,
    });
  }

  @ApiOkResponse({ description: 'No content.' })
  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove an override, falling back to the parent scope' })
  async reset(@Body() dto: ResetSettingDto, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    this.assertMayWrite(user, dto.scope, dto.key);
    await this.settings.reset(dto.scope, dto.depotId ?? null, dto.key, user.sub);
  }
}
