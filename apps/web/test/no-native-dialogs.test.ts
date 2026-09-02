import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * `window.confirm`, `window.prompt` and `window.alert` are banned in this app, and this is
 * what keeps them out.
 *
 * Four reasons, all of which cost something in production before step 06 of the console
 * audit removed the last of them:
 *
 *  1. They cannot be translated. The copy is a browser string in the browser's language,
 *     under a page rendered in Indonesian.
 *  2. They cannot be styled, and on a phone they arrive as a system sheet naming the
 *     origin — which reads as the site asking for something, not the app.
 *  3. A WebView may suppress them entirely. Android's `WebChromeClient` returns without
 *     showing anything unless the host implements `onJsConfirm`, so `confirm()` answers
 *     false and `prompt()` answers null: the action silently never runs, and nothing on
 *     screen says so. This app ships as an Android binary.
 *  4. `prompt()` accepts a blank string, and three of the four call sites filed that
 *     string as the recorded reason for an irreversible decision.
 *
 * `useConfirm()` (components/confirm.tsx) replaces all three in one line.
 */

const SRC = join(__dirname, '..', 'src');
const BANNED = /\bwindow\s*\.\s*(confirm|prompt|alert)\s*\(/;

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sources(path, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

/**
 * Comments are stripped first. The replacement components EXPLAIN what they replace, and
 * a gate that trips on its own explanation teaches people to delete the explanation.
 */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('native browser dialogs', () => {
  const files = sources(SRC);

  it('scans a real tree', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('are not used anywhere in apps/web/src', () => {
    const offenders = files
      .filter((f) => BANNED.test(code(readFileSync(f, 'utf8'))))
      .map((f) => f.slice(SRC.length + 1).split(String.fromCharCode(92)).join('/'));
    expect(offenders).toEqual([]);
  });

  it('the same scan catches one that is added', () => {
    // A check that has never failed is a check nobody has tested.
    expect(BANNED.test(code("if (!window.confirm('really?')) return;"))).toBe(true);
    expect(BANNED.test(code("const r = window.prompt('why?');"))).toBe(true);
    expect(BANNED.test(code("window . alert ( 'hi' )"))).toBe(true);
    // …and does not fire on prose about them.
    expect(BANNED.test(code('// window.confirm() is banned; use useConfirm()'))).toBe(false);
    expect(BANNED.test(code('/* replaces window.prompt() everywhere */'))).toBe(false);
  });
});
