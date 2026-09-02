import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalDiskStorageAdapter } from '../../src/infrastructure/storage/local-disk-storage.adapter';
import type { PaymentConfigService } from '../../src/config/payment-config.service';

function makeConfig(dir: string) {
  return {
    storageLocalDir: dir,
    storagePublicBaseUrl: 'http://localhost:3005',
  } as unknown as PaymentConfigService;
}

describe('LocalDiskStorageAdapter', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hm-pay-storage-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes under payment-proof/<uuid>.<ext> and returns a servable url', async () => {
    const adapter = new LocalDiskStorageAdapter(makeConfig(dir));

    const { url, key } = await adapter.put({
      body: Buffer.from('bytes'),
      contentType: 'image/png',
      ext: 'png',
    });

    expect(key).toMatch(/^payment-proof\/[0-9a-f-]{36}\.png$/);
    expect(url).toBe(`http://localhost:3005/uploads/${key}`);
    expect(readFileSync(join(dir, key), 'utf8')).toBe('bytes');
  });

  /*
   * CA-3-03. Deleting an account used to blank the column and stop there, leaving the
   * receipt on disk for anyone who still had its link.
   */
  it('removes the file the key names', async () => {
    const adapter = new LocalDiskStorageAdapter(makeConfig(dir));
    const { key } = await adapter.put({
      body: Buffer.from('bytes'),
      contentType: 'image/png',
      ext: 'png',
    });
    expect(existsSync(join(dir, key))).toBe(true);

    await adapter.remove(key);

    expect(existsSync(join(dir, key))).toBe(false);
  });

  /*
   * Erasure is retried — a purge sweep re-runs, an operator runs it twice — so a key that
   * is already gone has to be a success. `rm({ force: true })` is what makes that true.
   */
  it('treats a key that is already gone as removed, not as an error', async () => {
    const adapter = new LocalDiskStorageAdapter(makeConfig(dir));

    await expect(adapter.remove('payment-proof/never-existed.png')).resolves.toBeUndefined();
  });
});
