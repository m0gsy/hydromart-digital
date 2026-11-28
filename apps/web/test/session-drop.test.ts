/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://localhost/" }
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearSessionDrop,
  completeLogin,
  hadSession,
  markHadSession,
  noteSessionDrop,
  peekSessionDrop,
  sessionDropField,
} from '@/lib/session-drop';

beforeEach(() => localStorage.clear());

describe('session-drop marker (native shell)', () => {
  it('keeps the last reason', () => {
    noteSessionDrop('lock_sms');
    noteSessionDrop('signed_out');
    expect(peekSessionDrop()).toBe('signed_out');
    expect(sessionDropField()).toEqual({ sessionDrop: 'signed_out' });
  });

  it('writes vault_empty only when nothing else is known', () => {
    noteSessionDrop('vault_empty');
    expect(peekSessionDrop()).toBe('vault_empty');
    noteSessionDrop('refresh_refused');
    noteSessionDrop('vault_empty');
    expect(peekSessionDrop()).toBe('refresh_refused');
  });

  it('clears, and reads nothing from a value that is not one of the reasons', () => {
    noteSessionDrop('lock_sms');
    clearSessionDrop();
    expect(peekSessionDrop()).toBeNull();
    expect(sessionDropField()).toEqual({});
    localStorage.setItem('hm_session_drop', 'because');
    expect(peekSessionDrop()).toBeNull();
  });

  it('remembers that this device has held a session', () => {
    expect(hadSession()).toBe(false);
    markHadSession();
    expect(hadSession()).toBe(true);
  });

  it('completeLogin clears the old marker but keeps one written during the verify', () => {
    noteSessionDrop('lock_sms');
    completeLogin('lock_sms');
    expect(peekSessionDrop()).toBeNull();
    expect(hadSession()).toBe(true);

    noteSessionDrop('lock_sms');
    noteSessionDrop('vault_write_failed');
    completeLogin('lock_sms');
    expect(peekSessionDrop()).toBe('vault_write_failed');
  });

  it('never throws when storage does', () => {
    const boom = () => {
      throw new Error('denied');
    };
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom, removeItem: boom });
    expect(() => {
      noteSessionDrop('lock_sms');
      markHadSession();
      clearSessionDrop();
    }).not.toThrow();
    expect(peekSessionDrop()).toBeNull();
    expect(hadSession()).toBe(false);
    vi.unstubAllGlobals();
  });
});
