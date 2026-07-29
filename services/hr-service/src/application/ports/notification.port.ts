export const NOTIFICATION_PORT = Symbol('NOTIFICATION_PORT');

/**
 * One way out of HR to a person: crm-service writes the in-app feed AND sends WhatsApp.
 * hr-service deliberately owns no notification stack of its own.
 *
 * `subjectId` is the recipient's auth account id (Employee.authSubjectId) — an employee
 * without a login has none, so the caller skips them rather than inventing one.
 */
export interface NotificationPort {
  notify(
    event: string,
    phone: string,
    vars: Record<string, string>,
    subjectId: string,
  ): Promise<void>;
}
