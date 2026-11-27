import { Body, Controller, Get, HttpCode, Inject, Post, Query, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public, gridCell1km } from '@hydromart/platform';

import { UnservedDemandRepository, UnservedSummary } from '../application/ports/unserved-demand.repository';
import { CUSTOMER_TOKENS } from '../application/tokens';
import { RegionLookup } from '../infrastructure/geo/region-lookup';
import { RegionLookupDto, UnservedDemandQueryDto } from './dto/regions.dto';

export interface LookedUpPoint {
  kecamatan: { code: string; name: string } | null;
  kelurahan: { code: string; name: string } | null;
  gridCell: string;
}

export interface NamedKelurahan extends NamedCount {
  kecamatan: string;
}

export interface NamedCount {
  code: string | null;
  name: string | null;
  count: number;
}

/**
 * HD-20c: what dashboard-service's areas read asks of customer-service. Internal key only, and no
 * route returns a customer or an address: pins in, region codes out; unserved demand is already
 * anonymous and is aggregated in SQL.
 */
@ApiTags('Internal')
@Public()
@UseGuards(InternalAuthGuard)
@ApiSecurity('internal-key')
@Controller({ path: 'customers', version: '1' })
export class InternalRegionsController {
  constructor(
    private readonly regions: RegionLookup,
    @Inject(CUSTOMER_TOKENS.UnservedDemandRepository) private readonly unserved: UnservedDemandRepository,
  ) {}

  @ApiOkResponse({ description: 'points: for each pin, in order, its kecamatan and kelurahan (BPS code and name, or null) and its 1 km grid cell.' })
  @Post('internal/regions/lookup')
  @HttpCode(200)
  @ApiOperation({ summary: 'Which kecamatan, kelurahan and 1 km cell each pin is in (internal service auth)' })
  lookup(@Body() dto: RegionLookupDto): { points: LookedUpPoint[] } {
    // An unreadable asset must not look like "every pin is in no kecamatan".
    if (!this.regions.available()) throw new ServiceUnavailableException('Batas wilayah belum bisa dibaca.');
    return {
      points: dto.points.map((p) => {
        // An order's pin carries no accuracy, so it is treated as precise (both levels), unlike a GPS fix saved on an address.
        const hit = this.regions.find(p.lat, p.lng);
        return { kecamatan: hit?.kecamatan ?? null, kelurahan: hit?.kelurahan ?? null, gridCell: gridCell1km(p.lat, p.lng) };
      }),
    };
  }

  @ApiOkResponse({ description: 'kecamatan, kelurahan, grid: rows counted per cell (code or cell null = no kelurahan); bands: rows per distance band to the nearest depot.' })
  @Get('internal/unserved-demand')
  @ApiOperation({ summary: 'Anonymous out-of-area pins of one month, counted per cell and per distance band (internal service auth)' })
  async unservedDemand(@Query() q: UnservedDemandQueryDto): Promise<{
    kecamatan: NamedCount[];
    kelurahan: NamedKelurahan[];
    grid: { cell: string; count: number }[];
    bands: { band: string; count: number }[];
  }> {
    const s: UnservedSummary = await this.unserved.summarize(q.month);
    const named = (r: { code: string | null; count: number }): NamedCount => ({ ...r, name: r.code ? this.regions.nameOf(r.code) : null });
    return { kecamatan: s.kecamatan.map(named), kelurahan: s.kelurahan.map((r) => ({ ...named(r), kecamatan: r.kecamatan })), grid: s.grid, bands: s.bands };
  }
}
