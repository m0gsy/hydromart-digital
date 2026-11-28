// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { markHadSession, noteSessionDrop, peekSessionDrop, hadSession } from '@/lib/session-drop';

describe('session-drop on the web', () => {
  it('is a no-op everywhere', () => {
    noteSessionDrop('lock_sms');
    markHadSession();
    expect(localStorage.length).toBe(0);
    expect(peekSessionDrop()).toBeNull();
    expect(hadSession()).toBe(false);
  });
});
