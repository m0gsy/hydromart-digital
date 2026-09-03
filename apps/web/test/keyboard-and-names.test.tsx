// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FormError } from '@/components/ui';
import { scan, scanSource } from '../../../scripts/check-a11y.mjs';

/*
 * Console audit CA-1-53, CA-2-38 and the accessibility half of CA-2-68.
 *
 * Three defects with one shape: a control a mouse could reach and a keyboard could not, or
 * a message a screen reader was never told about. Each was measured before it was fixed —
 * three hidden file inputs, two clickable `<tr>`s, thirty-six bare error paragraphs and
 * fourteen unnamed form controls — and `scripts/check-a11y.mjs` is the same walk CI runs.
 *
 * This file is the regression gate the register requires: revert any one of those fixes and
 * `scan()` returns that finding and the first test goes red.
 */

const SRC = join(__dirname, '..', 'src');

describe('keyboard reachability and accessible names', () => {
  it('apps/web/src has no finding left', () => {
    // The message carries the offenders, not just a count — a red run should name them.
    expect(scan().map((f) => `${f.rule} ${f.file}:${f.line}`)).toEqual([]);
  });

  it('the same four rules fire on the shapes they exist to catch', () => {
    // A check that has never failed is a check nobody has tested.
    const rules = (text: string) => scanSource(text).map((f) => f.rule);

    expect(rules('<input type="file" onChange={pick} className="hidden" />')).toContain(
      'filePicker',
    );
    expect(rules('<input type="file" onChange={pick} className="sr-only" />')).not.toContain(
      'filePicker',
    );
    // A ref means a real <button> drives it, so the tab stop is the button.
    expect(rules('<input ref={r} type="file" hidden onChange={pick} />')).not.toContain(
      'filePicker',
    );

    expect(rules('<tr onClick={() => go(id)}><td>{name}</td></tr>')).toContain('clickableRow');
    expect(
      rules('<tr onClick={() => go(id)}><td><Link href={href}>{name}</Link></td></tr>'),
    ).not.toContain('clickableRow');

    expect(rules('{error && <p className="text-sm text-red-600">{error}</p>}')).toContain(
      'errorLiveRegion',
    );
    expect(rules('{saveError && <p className="x" role="alert">{saveError}</p>}')).not.toContain(
      'errorLiveRegion',
    );
    expect(rules('<FormError message={error} />')).not.toContain('errorLiveRegion');

    expect(rules('<select value={v} onChange={(e) => set(e.target.value)}>')).toContain(
      'controlName',
    );
    // `=>` inside a handler must not end the tag: that bug made 30 named controls read as
    // nameless, and it is the reason tagAttrs walks characters instead of matching a regex.
    expect(
      rules('<select value={v} onChange={(e) => set(e.target.value)} aria-label={t(k)}>'),
    ).not.toContain('controlName');
    expect(rules('<Field label={l}><select value={v}></select></Field>')).not.toContain(
      'controlName',
    );
  });

  it('the file picker on every import screen is a real tab stop', () => {
    // `hidden` is display:none — not focusable. `sr-only` is off-screen but focusable, and
    // this is the difference CA-1-53 was about.
    const src = readFileSync(join(SRC, 'components', 'csv-import.tsx'), 'utf8');
    expect(src).toMatch(/type="file"[\s\S]{0,200}className="sr-only"/);
    expect(src).not.toMatch(/type="file"[\s\S]{0,200}className="hidden"/);
  });

  it('the HQ order and depot rows carry a real link, not only a row onClick', () => {
    for (const page of [
      join(SRC, 'app', 'hq', 'orders', 'page.tsx'),
      join(SRC, 'app', 'hq', 'page.tsx'),
    ]) {
      const src = readFileSync(page, 'utf8');
      expect(src).toMatch(/<Link\b/);
      expect(src).toMatch(/from 'next\/link'/);
    }
  });
});

describe('FormError', () => {
  it('announces the failure', () => {
    render(<FormError message="Nomor tidak valid" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Nomor tidak valid');
  });

  it('renders nothing when there is nothing to say', () => {
    const { container } = render(<FormError message={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
