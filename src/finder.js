/* PageScan — locating registration patterns in a photograph.
 *
 * This is the classic QR finder search, kept deliberately small. Along every
 * row and every column of a binarised frame we look at five consecutive runs
 * of alternating colour, dark first:
 *
 *   dark light dark light dark
 *     1  :  1  : 3 :  1  :  1     a finder square, seen through its core
 *     1  :  1  : 1 :  1  :  1     an alignment square
 *
 * A single line proves nothing — a staff of music or a row of grid dots can
 * produce the same run lengths by accident — so a candidate only survives if
 * rows AND columns agree on the same spot. Anything linear fails that test by
 * construction, which is most of what a ruled sheet contains.
 *
 * The centre is then the mean of every line that hit it, thirty-odd samples
 * in each axis, which lands it well inside a pixel. */
window.PS = window.PS || {};
(function (PS) {
  'use strict';

  var MIN_MODULE = 1.5;    // px; below this a "pattern" is just sensor noise
  var RUN_TOL = 0.45;      // how far each single-module run may stray
  var MAX_HITS = 60000;    // hard ceiling on line hits, so noise cannot stall us
  var MIN_LINES = 3;       // minimum hits per axis before a cluster is believed

  /* Which shape, if any, these five run lengths describe. */
  function classify(a, b, c, d, e) {
    var unit = (a + b + d + e) / 4;
    if (unit < MIN_MODULE) return 0;
    var lo = unit * (1 - RUN_TOL), hi = unit * (1 + RUN_TOL);
    if (a < lo || a > hi || b < lo || b > hi || d < lo || d > hi || e < lo || e > hi) return 0;
    var ratio = c / unit;
    if (ratio >= 2.15 && ratio <= 3.95) return 7;   // finder: total is 7 modules
    if (ratio >= 0.55 && ratio <= 1.55) return 5;   // alignment: total is 5
    return 0;
  }

  /* Walk one axis of the mask, emitting a hit for every five-run window that
   * classifies. `vertical` swaps the roles of rows and columns. */
  function scanAxis(mask, w, h, vertical, hits) {
    var lines = vertical ? w : h;
    var count = vertical ? h : w;
    var step = vertical ? w : 1;
    var at = new Int32Array(count + 1), len = new Int32Array(count + 1);

    for (var i = 0; i < lines; i++) {
      if (hits.n >= MAX_HITS) return;
      var base = vertical ? i : i * w;
      var n = 0, prev = mask[base], from = 0, j, v;

      for (j = 1; j < count; j++) {
        v = mask[base + j * step];
        if (v === prev) continue;
        at[n] = from; len[n] = j - from; n++;
        prev = v; from = j;
      }
      at[n] = from; len[n] = count - from; n++;

      /* Run 0 and run n-1 are clipped by the frame edge, so their lengths mean
       * nothing; skip any window that leans on them. A marker cut off by the
       * edge of the photograph is unusable anyway. */
      var firstDark = mask[base] === 1;
      for (var k = 1; k + 5 < n; k++) {
        if ((k % 2 === 0) !== firstDark) continue;   // window must start dark
        var total = classify(len[k], len[k + 1], len[k + 2], len[k + 3], len[k + 4]);
        if (!total) continue;
        var mid = at[k + 2] + len[k + 2] / 2;
        var span = len[k] + len[k + 1] + len[k + 2] + len[k + 3] + len[k + 4];
        hits.push(vertical ? i + 0.5 : mid, vertical ? mid : i + 0.5,
                  span / total, total === 7 ? 1 : 0, vertical ? 1 : 0);
      }
    }
  }

  function hitStore() {
    return {
      n: 0, x: [], y: [], module: [], finder: [], vertical: [],
      push: function (x, y, module, finder, vertical) {
        if (this.n >= MAX_HITS) return;
        this.x.push(x); this.y.push(y); this.module.push(module);
        this.finder.push(finder); this.vertical.push(vertical);
        this.n++;
      }
    };
  }

  /* Gather hits that sit on top of each other. Every line through one marker
   * reports a point within a couple of modules of its centre, and two markers
   * are never closer than a corner of the sheet is to another. */
  function cluster(hits) {
    var out = [];
    for (var i = 0; i < hits.n; i++) {
      var x = hits.x[i], y = hits.y[i], m = hits.module[i];
      var tol = m * 2.2, best = null, bestD = Infinity;
      for (var c = 0; c < out.length; c++) {
        var g = out[c];
        var cx = g.sx / g.n, cy = g.sy / g.n;
        if (Math.abs(cx - x) > tol || Math.abs(cy - y) > tol) continue;
        if (g.sm / g.n > m * 2 || m > (g.sm / g.n) * 2) continue;
        var d = (cx - x) * (cx - x) + (cy - y) * (cy - y);
        if (d < bestD) { bestD = d; best = g; }
      }
      if (!best) {
        best = { sx: 0, sy: 0, sm: 0, n: 0, nv: 0, nh: 0, finder: 0 };
        out.push(best);
      }
      best.sx += x; best.sy += y; best.sm += m; best.n++;
      best.finder += hits.finder[i];
      if (hits.vertical[i]) best.nv++; else best.nh++;
    }
    return out;
  }

  /* Candidate markers in one binarised frame, strongest support first. */
  function centres(mask, w, h) {
    var hits = hitStore();
    scanAxis(mask, w, h, false, hits);
    scanAxis(mask, w, h, true, hits);

    return cluster(hits)
      .filter(function (g) { return g.nh >= MIN_LINES && g.nv >= MIN_LINES; })
      .map(function (g) {
        return {
          x: g.sx / g.n, y: g.sy / g.n,
          module: g.sm / g.n,
          kind: g.finder * 2 >= g.n ? 'finder' : 'align',
          support: Math.min(g.nh, g.nv)
        };
      })
      .sort(function (a, b) { return b.support - a.support; });
  }

  PS.finder = { centres: centres, classify: classify };
})(window.PS);
