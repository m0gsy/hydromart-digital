/*
 * Injected into every document of an APK under test, BEFORE its bundle runs.
 *
 * A production React bundle reports a hydration mismatch as `Minified React error #418`
 * with the diff stripped (`args[]=`), and building a development-mode static export to get
 * that diff back is a day of work. So record what React actually DID to the DOM instead:
 * every text, attribute and child mutation, flushed synchronously the moment a console
 * error fires. The repair is the diff.
 *
 * Two things here are not style and will break it if changed:
 *   - `mo.observe(document)`, not `document.documentElement` — this runs on the empty
 *     document, where `documentElement` is still null and the observe throws. The whole
 *     probe then silently does not exist and every screen reports zero errors.
 *   - `mo.takeRecords()` inside the console.error hook. Mutation records are delivered in a
 *     microtask, i.e. after React has finished repairing; taking them by hand is what puts
 *     the error and the repair that caused it next to each other.
 *
 * Plain ES5, no modules: it is handed to `Page.addScriptToEvaluateOnNewDocument` as a
 * string, and the WebViews this ships to are as old as Chrome 111.
 */
(function () {
  var L = (window.__HYDRATION_PROBE = { mut: [], err: [], snap: null });
  var t0 = Date.now();

  function inHead(n) {
    while (n) {
      if (n.nodeName === 'HEAD') return true;
      n = n.parentNode;
    }
    return false;
  }

  /** `div[3]>ul[1]>#text[0]` — enough to find the node again in the snapshot. */
  function path(n) {
    var parts = [],
      guard = 0;
    while (n && n !== document.documentElement && guard++ < 40) {
      var p = n.parentNode;
      if (!p) break;
      var i = Array.prototype.indexOf.call(p.childNodes, n);
      parts.unshift((n.nodeType === 3 ? '#text' : (n.nodeName || '?').toLowerCase()) + '[' + i + ']');
      n = p;
    }
    return parts.join('>');
  }

  function cut(s) {
    s = String(s == null ? '' : s);
    return s.length > 140 ? s.slice(0, 140) + '…' : s;
  }

  function take(recs) {
    for (var i = 0; i < recs.length; i++) {
      var r = recs[i];
      // The parser's own inserts are in here too; a cap keeps a long-lived page bounded.
      if (L.mut.length > 600) return;
      if (inHead(r.target)) continue;
      if (r.type === 'characterData') {
        L.mut.push({ t: Date.now() - t0, k: 'text', p: path(r.target), from: cut(r.oldValue), to: cut(r.target.data) });
      } else if (r.type === 'attributes') {
        L.mut.push({
          t: Date.now() - t0,
          k: 'attr:' + r.attributeName,
          p: path(r.target),
          from: cut(r.oldValue),
          to: cut(r.target.getAttribute(r.attributeName)),
        });
      } else {
        var add = [],
          rem = [];
        for (var a = 0; a < r.addedNodes.length; a++)
          add.push(cut(r.addedNodes[a].outerHTML || r.addedNodes[a].textContent || r.addedNodes[a].nodeName));
        for (var b = 0; b < r.removedNodes.length; b++)
          rem.push(cut(r.removedNodes[b].outerHTML || r.removedNodes[b].textContent || r.removedNodes[b].nodeName));
        if (add.length || rem.length)
          L.mut.push({ t: Date.now() - t0, k: 'child', p: path(r.target), from: rem.join('|'), to: add.join('|') });
      }
    }
  }

  var mo = new MutationObserver(take);
  mo.observe(document, {
    subtree: true,
    childList: true,
    characterData: true,
    characterDataOldValue: true,
    attributes: true,
    attributeOldValue: true,
  });

  var ce = console.error;
  console.error = function () {
    try {
      // The document as it stood when the FIRST error fired: still mostly server HTML, which
      // is what makes it comparable with the file the export wrote.
      if (!L.snap) L.snap = (document.documentElement && document.documentElement.outerHTML) || '';
      take(mo.takeRecords());
      var msg = '';
      for (var i = 0; i < arguments.length; i++) {
        var a = arguments[i];
        msg += (a && a.message ? a.message : String(a)) + ' ';
      }
      L.err.push({ t: Date.now() - t0, at: L.mut.length, msg: msg.slice(0, 300) });
    } catch (e) {
      /* a probe must never be the reason a screen fails */
    }
    return ce.apply(console, arguments);
  };

  // React rethrows a recoverable hydration error at the top level as well; without this the
  // count is half of what the console shows.
  window.addEventListener('error', function (e) {
    try {
      take(mo.takeRecords());
      L.err.push({ t: Date.now() - t0, at: L.mut.length, msg: 'window.error: ' + (e.message || '') });
    } catch (x) {
      /* same */
    }
  });

  window.__HYDRATION_PROBE_FLUSH = function () {
    take(mo.takeRecords());
    return L;
  };
})();
