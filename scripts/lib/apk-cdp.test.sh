#!/usr/bin/env bash
# Self-check for the pure halves of scripts/lib/apk-cdp.mjs — the two functions that decide
# WHICH document an APK probe fetches and WHAT path the app believes it is on. Both were
# wrong once in a way no probe reported: the file name reached `usePathname()`, every screen
# rendered its `pushed` chrome instead of its own, and React threw the server tree away
# (#418). Needs no device, so it is gated like any other logic.
set -euo pipefail
cd "$(dirname "$0")"

node --input-type=module -e '
import assert from "node:assert/strict";
import { asFile, routePathname, PATH_FIX } from "./apk-cdp.mjs";

// Capacitor resolves an extensionless path through its SPA fallback and serves the HOME
// document, so every probe route has to name its file.
assert.equal(asFile("/products/"), "/products/index.html");
assert.equal(asFile("/products"), "/products/index.html");
assert.equal(asFile("/orders/detail?id=abc"), "/orders/detail/index.html?id=abc");
// Already a file, or the root the app launches on: left alone.
assert.equal(asFile("/"), "/");
assert.equal(asFile("/404.html"), "/404.html");

assert.equal(routePathname("/products/index.html"), "/products/");
assert.equal(routePathname("/index.html"), "/");
assert.equal(routePathname("/products/"), "/products/");
assert.equal(routePathname("/"), "/");
// Not a path segment of its own — a route legitimately called that must survive.
assert.equal(routePathname("/my-index.html"), "/my-index.html");

// The snippet injected into every probe document, run against a fake location/history.
const run = (pathname, search = "", hash = "") => {
  let replaced = null;
  new Function("location", "history", PATH_FIX)(
    { pathname, search, hash },
    { state: { k: 1 }, replaceState: (_s, _t, url) => (replaced = url) },
  );
  return replaced;
};
assert.equal(run("/products/index.html"), "/products/");
assert.equal(run("/orders/detail/index.html", "?id=abc", "#top"), "/orders/detail/?id=abc#top");
// A document that was NOT reached through asFile must not be touched.
assert.equal(run("/products/"), null);
assert.equal(run("/"), null);

console.log("apk-cdp self-check: ok");
'
