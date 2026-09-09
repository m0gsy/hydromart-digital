import { describe, expect, it } from 'vitest';

import { endpoints } from '@/lib/endpoints';

/**
 * The depot endpoint builders, on the branches that decide what reaches the server.
 *
 * Same argument as the HR builders: every optional parameter here is a filter a screen
 * believes it is sending, and the failures in this repo have all been a parameter the URL
 * quietly dropped. These are pure functions, so pinning them costs nothing and the contract
 * stops drifting from the screen that depends on it.
 */

describe('depot inventory endpoints', () => {
  it('asks for a depot’s lines with no query when nothing is filtered', () => {
    expect(endpoints.inventory.lines('d-1')).toBe('/depots/api/v1/depots/d-1/inventory');
  });

  it('carries the type filter and the low-stock flag', () => {
    const url = endpoints.inventory.lines('d-1', { itemType: 'PRODUK', lowStockOnly: true });
    expect(url).toContain('itemType=PRODUK');
    expect(url).toContain('lowStockOnly=true');
  });

  it('omits lowStockOnly when it is false, rather than sending false', () => {
    // `lowStockOnly=false` and "no filter" mean the same thing to the server, but only one
    // of them survives a future change to how the flag is read.
    expect(endpoints.inventory.lines('d-1', { lowStockOnly: false })).toBe(
      '/depots/api/v1/depots/d-1/inventory',
    );
  });

  it('builds the depot movement ledger with its window, type and paging', () => {
    const url = endpoints.inventory.depotMovements('d-1', {
      type: 'SALE',
      from: '2026-07-01',
      to: '2026-07-31',
      page: 2,
      limit: 50,
    });
    expect(url).toContain('type=SALE');
    expect(url).toContain('from=2026-07-01');
    expect(url).toContain('to=2026-07-31');
    expect(url).toContain('page=2');
    expect(url).toContain('limit=50');
    expect(endpoints.inventory.depotMovements('d-1')).toBe(
      '/depots/api/v1/depots/d-1/inventory/movements',
    );
  });

  /*
   * CA-2-54. Both halves of a transfer are read from the same table by the depot that acts
   * on them, and `direction` is the only thing telling them apart: getting it wrong would
   * show a depot its own outgoing goods as things to receive.
   */
  it('reads each side of a transfer from the depot that acts on it', () => {
    expect(endpoints.inventory.transfers({ depotId: 'd-1', direction: 'in' })).toContain(
      'direction=in',
    );
    expect(endpoints.inventory.transfers({ depotId: 'd-1', direction: 'out' })).toContain(
      'direction=out',
    );
    const filtered = endpoints.inventory.transfers({
      depotId: 'd-1',
      direction: 'in',
      status: 'SENT',
    });
    expect(filtered).toContain('status=SENT');
  });

  it('addresses one transfer by id, encoded', () => {
    expect(endpoints.inventory.receiveTransfer('trf 1')).toContain('trf%201/receive');
    expect(endpoints.inventory.cancelTransfer('trf 1')).toContain('trf%201/cancel');
    expect(endpoints.inventory.sendTransfer).toBe('/depots/api/v1/stock-transfers');
  });

  it('scopes the depot incidents inbox, and filters it by status', () => {
    expect(endpoints.incidents.list({ depotId: 'd-1' })).toContain('depotId=d-1');
    expect(endpoints.incidents.list({ depotId: 'd-1', status: 'OPEN' })).toContain('status=OPEN');
  });
});
