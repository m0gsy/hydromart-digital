import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ProductConfigService } from '../../src/config/product-config.service';
import { LocalDiskStorageAdapter } from '../../src/infrastructure/storage/local-disk-storage.adapter';

describe('LocalDiskStorageAdapter', () => {
  const root = join(tmpdir(), `hydromart-storage-${Date.now()}`);
  const config = {
    storageLocalDir: root,
    storagePublicBaseUrl: 'http://localhost:3003',
  } as unknown as ProductConfigService;
  const adapter = new LocalDiskStorageAdapter(config);

  afterAll(() => rm(root, { recursive: true, force: true }));

  it('writes the blob under products/ and returns a matching public url and key', async () => {
    const body = Buffer.from('image-bytes');
    const result = await adapter.put({ body, contentType: 'image/png', ext: 'png' });

    expect(result.key).toMatch(/^products\/[0-9a-f-]+\.png$/);
    expect(result.url).toBe(`http://localhost:3003/uploads/${result.key}`);
    expect(await readFile(join(root, result.key))).toEqual(body);
  });
});
