import { api, ApiError } from './api';
import { endpoints } from './endpoints';
import type { Announcement } from './hr';

/** An announcement HR sent me, with my read receipt. */
export type MyAnnouncement = Announcement & { read: boolean };

/**
 * HR's announcements to me. An account with no employee record (404 from hr-service) has
 * none — an answer, not a failure to show. Flow 5d: read by the courier's inbox and by the
 * courier home's door to it.
 */
export function myAnnouncements(): Promise<MyAnnouncement[]> {
  return api.get<MyAnnouncement[]>(endpoints.hr.announcementsMe, true).catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 404) return [];
    throw e;
  });
}
