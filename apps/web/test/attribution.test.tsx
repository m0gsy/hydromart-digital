// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ query: '' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(nav.query) }));

import { SourceCapture } from '@/components/source-capture';
import { captureSource, readSources } from '@/lib/attribution';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  window.history.replaceState({}, '', '/');
});

describe('SourceCapture (in the root layout)', () => {
  it('notes the code of the link a visit opened with, on any page, and draws nothing', () => {
    nav.query = 'src=poster-depot-dpk01';
    const { container } = render(<SourceCapture />);
    expect(container.innerHTML).toBe('');
    expect(readSources()).toEqual({
      firstSource: 'poster-depot-dpk01',
      lastSource: 'poster-depot-dpk01',
    });
  });

  // The shell never remounts: an in-app link or a deep link arrives as a navigation, onto the
  // same screen too, so what counts is the query changing, not the path.
  it('notes a coded link again whenever the query changes, the first one staying first', () => {
    nav.query = 'src=pameran-jkt';
    const view = render(<SourceCapture />);
    nav.query = 'src=banner-beranda&x=1';
    view.rerender(<SourceCapture />);
    expect(readSources()).toEqual({ firstSource: 'pameran-jkt', lastSource: 'banner-beranda' });
    nav.query = '';
    view.rerender(<SourceCapture />);
    expect(readSources().lastSource).toBe('banner-beranda');
  });
});

/**
 * HD-8. The attribution rule of the Plan Eksekusi: the first source stays, the latest is kept
 * beside it. A source is only ever a campaign code from a coded link, never anything else.
 */
describe('lib/attribution', () => {
  it('keeps the first code and moves the latest', () => {
    captureSource('?src=pameran-jkt');
    expect(readSources()).toEqual({ firstSource: 'pameran-jkt', lastSource: 'pameran-jkt' });
    captureSource('?utm_source=Meta&utm_medium=cpc');
    expect(readSources()).toEqual({ firstSource: 'pameran-jkt', lastSource: 'meta' });
    captureSource('?src=qr-depot-bdg01');
    expect(readSources()).toEqual({ firstSource: 'pameran-jkt', lastSource: 'qr-depot-bdg01' });
  });

  it('takes our own src over an ad platform utm_source', () => {
    captureSource('?utm_source=meta&src=qr-depot');
    expect(readSources().lastSource).toBe('qr-depot');
  });

  it('stores nothing for a link with no code, or a code of the wrong shape', () => {
    for (const search of [
      '',
      '?ref=ABC123',
      '?src=',
      '?src=-iklan',
      '?src=a%20b',
      '?src=a%2Fb',
      '?src=%3Cscript%3E',
      `?src=${'x'.repeat(65)}`,
    ]) {
      captureSource(search);
    }
    expect(readSources()).toEqual({});
    expect(localStorage.length).toBe(0);
  });

  it('accepts the longest code there is, and lower-cases what a link shouts', () => {
    captureSource(`?src=${'X'.repeat(64)}`);
    expect(readSources().firstSource).toBe('x'.repeat(64));
  });

  it('starts the first source over when the stored one is not a code', () => {
    localStorage.setItem('hydromart.source', JSON.stringify({ first: 'NOT A CODE', last: 'x' }));
    captureSource('?src=pameran');
    expect(readSources()).toEqual({ firstSource: 'pameran', lastSource: 'pameran' });
  });

  it('reads nothing from a store somebody edited by hand', () => {
    localStorage.setItem('hydromart.source', '{not json');
    expect(readSources()).toEqual({});
    localStorage.setItem('hydromart.source', JSON.stringify({ first: 'UPPER', last: 7 }));
    expect(readSources()).toEqual({});
    localStorage.setItem('hydromart.source', 'null');
    expect(readSources()).toEqual({});
    localStorage.setItem('hydromart.source', JSON.stringify({ first: 'pameran', last: '<x>' }));
    expect(readSources()).toEqual({ firstSource: 'pameran' });
  });

  it('carries on unattributed when storage is full', () => {
    // On the instance, not Storage.prototype: test/setup.ts may have put a plain object here.
    const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => captureSource('?src=pameran')).not.toThrow();
    expect(setItem).toHaveBeenCalled();
    setItem.mockRestore();
    expect(readSources()).toEqual({});
  });

  it('carries on unattributed when storage is blocked outright', () => {
    const own = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    try {
      expect(readSources()).toEqual({});
      expect(() => captureSource('?src=pameran')).not.toThrow();
    } finally {
      if (own) Object.defineProperty(window, 'localStorage', own);
      else delete (window as { localStorage?: Storage }).localStorage;
    }
    expect(window.localStorage.getItem('hydromart.source')).toBeNull();
  });
});
