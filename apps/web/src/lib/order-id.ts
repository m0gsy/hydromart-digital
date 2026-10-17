/**
 * Runs `load` once the order id from the address bar is known.
 *
 * The id is read after hydration, so for a moment it is the empty string — and a link with no
 * `?id=` never gets one. Asking the API for order "" answered 404, and for its payments
 * (`?orderId=`) 400, on every such visit: two console errors for a request nobody meant to make.
 * While there is no id the promise stays pending, so the screen keeps its skeleton rather than
 * flashing "order not found" for a page that has simply not finished loading.
 */
export function whenOrderKnown<T>(id: string, load: (id: string) => Promise<T>): Promise<T> {
  return id ? load(id) : new Promise<T>(() => undefined);
}
