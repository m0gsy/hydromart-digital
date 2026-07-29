import { DisabledStorageAdapter } from '../../src/infrastructure/storage/disabled-storage.adapter';
import { uploadFrame } from '../../src/infrastructure/storage/upload-frame';
import { StoragePort, StoragePutInput } from '../../src/application/ports/storage.port';

describe('storage', () => {
  it('uploadFrame returns null when no storage is bound (persistence disabled)', async () => {
    expect(await uploadFrame(undefined, Buffer.from('x'), 'hr/attendance')).toBeNull();
  });

  it('DisabledStorageAdapter is a no-op returning an empty url → uploadFrame yields null', async () => {
    expect(
      await uploadFrame(new DisabledStorageAdapter(), Buffer.from('x'), 'hr/faces'),
    ).toBeNull();
  });

  // The punch is already proven by the face match and the geofence; a broken bucket must
  // cost the depot a photo, not the whole day's attendance.
  it('uploadFrame swallows a storage failure and yields null instead of throwing', async () => {
    const storage: StoragePort = {
      put: async () => {
        throw new Error('No value provided for input HTTP label: Bucket');
      },
    };
    await expect(uploadFrame(storage, Buffer.from('x'), 'hr/attendance')).resolves.toBeNull();
  });

  it('survives a non-Error rejection too (some SDK paths throw strings)', async () => {
    const storage: StoragePort = {
      put: async () => {
        throw 'socket hang up';
      },
    };
    await expect(uploadFrame(storage, Buffer.from('x'), 'hr/faces')).resolves.toBeNull();
  });

  it('uploadFrame returns the stored url and forwards the key prefix + jpeg metadata', async () => {
    let seen: StoragePutInput | undefined;
    const storage: StoragePort = {
      put: async (input) => {
        seen = input;
        return { url: 'https://cdn/hr/attendance/abc.jpg', key: 'hr/attendance/abc.jpg' };
      },
    };
    const url = await uploadFrame(storage, Buffer.from('frame'), 'hr/attendance');
    expect(url).toBe('https://cdn/hr/attendance/abc.jpg');
    expect(seen).toMatchObject({
      contentType: 'image/jpeg',
      ext: 'jpg',
      keyPrefix: 'hr/attendance',
    });
  });
});
