// One fetch for every seed/E2E script.
//
// The gateway throttles at RATE_LIMIT_MAX per RATE_LIMIT_TTL_SECONDS (100/60s by default), and
// these scripts fire thousands of requests. A 429 is the rate limiter working, not the thing
// under test: in a seed it aborts a half-written fixture, and in an F6 check it reads as a
// permission failure that never happened. Wait the window out and repeat the same request.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Every paginated list endpoint caps `limit` at 100 and answers 400 above it — and a 400 body has
// no `items`, so an over-sized ask silently reads as "nothing there" instead of failing loudly.
// Walk the pages: `page` is 1-based, and a short page is the last one.
export async function listAllPages(fetchPage, pageSize = 100) {
  const all = [];
  for (let page = 1; ; page += 1) {
    const batch = await fetchPage(page, pageSize);
    all.push(...batch);
    if (batch.length < pageSize) return all;
  }
}

export async function fetchThrottled(url, init, { attempts = 20, fallbackMs = 5000 } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(url, init);
    if (res.status !== 429 || attempt >= attempts) return res;
    const retryAfter = Number(res.headers.get('retry-after'));
    await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : fallbackMs);
  }
}
