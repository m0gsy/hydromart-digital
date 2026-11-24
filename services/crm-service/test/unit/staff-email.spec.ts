import { readFileSync } from 'fs';
import { join } from 'path';

import {
  NotificationEvent,
  STAFF_TOGGLE_FOR_EVENT,
  renderMessage,
  templateFor,
} from '../../src/domain/notification-event';
import { STAFF_EMAIL_TEMPLATES } from '../../src/domain/staff-email';

/*
 * Owner rule 24 Nov 2026: every staff notification an n8n workflow raises goes out on every
 * channel. The kinds the machine route raises are the ones its controller names; each needs an
 * email: a template, and the switch it is sent under (the push's own). A new route that names a
 * kind with neither fails here.
 */
const EXTERNAL = readFileSync(
  join(__dirname, '../../src/modules/notification-external.controller.ts'),
  'utf8',
);
const RAISED = [
  ...new Set([...EXTERNAL.matchAll(/NotificationEvent\.([A-Z_]+)/g)].map((m) => m[1])),
] as NotificationEvent[];
const tokens = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);

describe('the email channel of the notifications n8n raises', () => {
  it('reads the kinds the external route raises', () => {
    expect(RAISED).toContain(NotificationEvent.FRANCHISE_APPLICATION_SUBMITTED);
  });

  it.each(RAISED)('%s has an email template and a switch to send it under', (event) => {
    expect(STAFF_EMAIL_TEMPLATES[event]).toEqual({ subject: expect.any(String), body: expect.any(String) });
    expect(STAFF_TOGGLE_FOR_EVENT[event]).toEqual(expect.any(String));
  });

  // The same facts as the bell and push, never more: the email carries no field they do not.
  it.each(Object.entries(STAFF_EMAIL_TEMPLATES))('%s names nothing the bell does not', (event, template) => {
    const bell = tokens(templateFor(event as NotificationEvent, 'id'));
    expect(tokens(`${template!.subject} ${template!.body}`).filter((t) => !bell.includes(t))).toEqual([]);
  });
});

describe('the franchise application email', () => {
  const template = STAFF_EMAIL_TEMPLATES[NotificationEvent.FRANCHISE_APPLICATION_SUBMITTED]!;
  const vars = { city: 'Bekasi', province: 'Jawa Barat', applicationId: 'app-1' };

  it('names the place and calls the applicant calon mitra, as the bell does', () => {
    expect(renderMessage(template.subject, vars)).toBe('Lamaran waralaba baru: calon mitra di Bekasi, Jawa Barat');
    expect(renderMessage(template.body, vars)).toContain('calon mitra di Bekasi, Jawa Barat.');
    expect(`${template.subject} ${template.body}`).not.toMatch(/investor|investasi/i);
  });
});
