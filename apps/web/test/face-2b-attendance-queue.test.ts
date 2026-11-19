import { describe, expect, it, vi } from 'vitest';

/**
 * Face plan PR-2: punches held PENDING wait for HR in the decision inbox too, counted from the
 * same list (and for the same reader, hrAdmin) as the PENDING card on /hr/attendance. A daily
 * worker is not paid for a PENDING day, so a queue nobody is told about costs someone a wage.
 */
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { get, getCached: get }, ApiError: class extends Error {} }));

describe('the PENDING attendance queue', () => {
  it('counts the PENDING punches from the total of the attendance list', async () => {
    get.mockResolvedValue({ rows: [{}], total: 7 });
    const { DECISION_QUEUES } = await import('@/lib/decision-queues');
    const queue = DECISION_QUEUES.find((q) => q.key === 'attendance')!;
    await expect(queue.count!('HR', null)).resolves.toBe(7);
    const url = String(get.mock.calls[0]![0]);
    expect(url).toContain('/attendance');
    expect(url).toContain('status=PENDING');
  });

  it("is HR's to decide, not a depot manager's or a courier's", async () => {
    const { queuesFor } = await import('@/lib/decision-queues');
    expect(queuesFor('HR').map((q) => q.key)).toContain('attendance');
    expect(queuesFor('MANAGER').map((q) => q.key)).not.toContain('attendance');
    expect(queuesFor('STAFF_DEPOT')).toEqual([]);
  });
});
