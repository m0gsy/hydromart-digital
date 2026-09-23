import { AttendanceService } from '../../src/application/services/attendance.service';

/*
 * HR-4, owner decision 2026-09-17 — attendance selfies stop being kept forever.
 *
 * Only the departed-employee scrub ever deleted one, so a face frame taken on a Tuesday was
 * kept for as long as that person worked here. The punch, its hours and its match score are
 * payroll evidence and stay; the photo goes ninety days on (the window head office sets,
 * passed in as a cutoff by admin-service).
 */
const CUTOFF = new Date('2026-06-19T00:00:00.000Z');

function make(photos: string[], remove = jest.fn().mockResolvedValue(undefined)) {
  const repo = {
    photosBefore: jest.fn().mockResolvedValue(photos),
    clearPhotosBefore: jest.fn().mockResolvedValue(photos.length),
  };
  const storage = { remove };
  const service = new AttendanceService(
    repo as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    storage as never,
  );
  return { repo, storage, service };
}

describe('AttendanceService.purgePhotosOlderThan (HR-4)', () => {
  it('deletes each distinct object, then clears the columns that pointed at them', async () => {
    const { repo, storage, service } = make([
      'hr/attendance/a.jpg',
      'https://nos.example/hydromart-hr/hr/attendance/b.jpg',
      'hr/attendance/a.jpg',
      'typed-by-hand',
    ]);

    await expect(service.purgePhotosOlderThan(CUTOFF)).resolves.toEqual({ purged: 4 });

    expect(repo.photosBefore).toHaveBeenCalledWith(CUTOFF, 500);
    expect(storage.remove.mock.calls.map((c) => c[0])).toEqual([
      'hr/attendance/a.jpg',
      'hr/attendance/b.jpg',
    ]);
    expect(repo.clearPhotosBefore).toHaveBeenCalledWith(CUTOFF, 500);
  });

  /*
   * The object goes FIRST and the row is cleared after. A bucket that refuses the delete
   * leaves the row pointing at the object, so the next sweep tries again — nulling the
   * column first would orphan a face nothing could find.
   */
  it('keeps the rows when the bucket refuses, so the next sweep can retry', async () => {
    const remove = jest.fn().mockRejectedValue(new Error('denied'));
    const { repo, service } = make(['hr/attendance/a.jpg'], remove);

    await expect(service.purgePhotosOlderThan(CUTOFF)).resolves.toEqual({ purged: 0 });
    expect(repo.clearPhotosBefore).not.toHaveBeenCalled();
  });

  it('does nothing at all when no storage is bound', async () => {
    const repo = {
      photosBefore: jest.fn().mockResolvedValue(['hr/attendance/a.jpg']),
      clearPhotosBefore: jest.fn().mockResolvedValue(1),
    };
    const service = new AttendanceService(
      repo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(service.purgePhotosOlderThan(CUTOFF)).resolves.toEqual({ purged: 1 });
  });
});
