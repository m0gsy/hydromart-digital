import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalDiskStorageAdapter } from '../../src/infrastructure/storage/local-disk-storage.adapter';

function makeConfig(dir: string) {
  return {
    storageLocalDir: dir,
    storagePublicBaseUrl: 'http://localhost:3006',
  } as unknown as import('../../src/config/delivery-config.service').DeliveryConfigService;
}

describe('LocalDiskStorageAdapter', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hm-storage-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes the file under pod/ and returns a matching url + key', async () => {
    const adapter = new LocalDiskStorageAdapter(makeConfig(dir));
    const body = Buffer.from('fake-png-bytes');

    const { url, key } = await adapter.put({ body, contentType: 'image/png', ext: 'png' });

    expect(key).toMatch(/^pod\/[0-9a-f-]{36}\.png$/);
    expect(url).toBe(`http://localhost:3006/uploads/${key}`);
    expect(readFileSync(join(dir, key))).toEqual(body);
  });

  // H-22: idempotent by contract — the retention sweep must not fail on a key that a
  // previous run (or a manual cleanup) already removed.
  it('removes a written file, and treats a missing one as done', async () => {
    const adapter = new LocalDiskStorageAdapter(makeConfig(dir));
    const { key } = await adapter.put({
      body: Buffer.from('x'),
      contentType: 'image/png',
      ext: 'png',
    });

    await adapter.remove(key);
    expect(existsSync(join(dir, key))).toBe(false);

    await expect(adapter.remove(key)).resolves.toBeUndefined();
  });
});
