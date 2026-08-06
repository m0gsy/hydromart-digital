import { DisabledStorageAdapter } from '../../src/infrastructure/storage/disabled-storage.adapter';
import { storeFrame } from '../../src/infrastructure/storage/upload-frame';
import { StoragePort, StoragePutInput } from '../../src/application/ports/storage.port';

describe('storage', () => {
  it('storeFrame returns null when no storage is bound (persistence disabled)', async () => {
    expect(await storeFrame(undefined, Buffer.from('x'), 'hr/attendance')).toBeNull();
  });

  it('DisabledStorageAdapter is a no-op returning an empty key → storeFrame yields null', async () => {
    expect(
      await storeFrame(new DisabledStorageAdapter(), Buffer.from('x'), 'hr/faces'),
    ).toBeNull();
  });

  // The punch is already proven by the face match and the geofence; a broken bucket must
  // cost the depot a photo, not the whole day's attendance.
  it('storeFrame swallows a storage failure and yields null instead of throwing', async () => {
    const storage: StoragePort = {
      put: async () => {
        throw new Error('No value provided for input HTTP label: Bucket');
      },
      remove: async () => undefined,
    };
    await expect(storeFrame(storage, Buffer.from('x'), 'hr/attendance')).resolves.toBeNull();
  });

  it('survives a non-Error rejection too (some SDK paths throw strings)', async () => {
    const storage: StoragePort = {
      put: async () => {
        throw 'socket hang up';
      },
      remove: async () => undefined,
    };
    await expect(storeFrame(storage, Buffer.from('x'), 'hr/faces')).resolves.toBeNull();
  });

  // B-18: the KEY is what gets stored on the row. A permanent public URL to a face frame,
  // sitting in a column anyone with read access can copy, is the thing this fixes.
  it('storeFrame returns the storage key, not the public url, and forwards jpeg metadata', async () => {
    let seen: StoragePutInput | undefined;
    const storage: StoragePort = {
      put: async (input) => {
        seen = input;
        return { url: 'https://cdn/hr/attendance/abc.jpg', key: 'hr/attendance/abc.jpg' };
      },
      remove: async () => undefined,
    };
    const stored = await storeFrame(storage, Buffer.from('frame'), 'hr/attendance');
    expect(stored).toBe('hr/attendance/abc.jpg');
    expect(seen).toMatchObject({
      contentType: 'image/jpeg',
      ext: 'jpg',
      keyPrefix: 'hr/attendance',
    });
  });
});
