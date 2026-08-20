/* PageScan — locating registration marks in a photograph.
 *
 * Three corners carry an L hugging the page edges; the fourth carries a
 * five-module alignment square. The fiducial is the joint centre of each L
 * (arm midlines intersected) and the centre of the alignment square.
 *
 * L detection: a dark pixel whose cardinal runs show two long arms and two
 * short edge-through-stroke readings is a crook. Outer corners of the same L
 * are rejected because their short runs are near zero.
 *
 * Alignment detection: the classic 1:1:1:1:1 five-run window through the
 * core, kept only where rows and columns agree. */
window.PS = window.PS || {};
(function (PS) {
  'use strict';

  var MIN_WIDTH = 1.5;
  var MAX_WIDTH = 48;
  var ARM_MIN = 3.0;
  var OPEN_MIN = 0.35;
  var OPEN_MAX = 1.85;
  var RUN_TOL = 0.45;
  var MAX_HITS = 80000;
  var MIN_HITS = 2;

  function runMaps(mask, w, h) {
    var N = new Int16Array(w * h), S = new Int16Array(w * h);
    var E = new Int16Array(w * h), W = new Int16Array(w * h);
    var x, y, i, run;

    for (y = 0; y < h; y++) {
      run = 0;
      for (x = 0; x < w; x++) {
        i = y * w + x;
        if (mask[i]) { W[i] = run; run++; } else run = 0;
      }
      run = 0;
      for (x = w - 1; x >= 0; x--) {
        i = y * w + x;
        if (mask[i]) { E[i] = run; run++; } else run = 0;
      }
    }
    for (x = 0; x < w; x++) {
      run = 0;
      for (y = 0; y < h; y++) {
        i = y * w + x;
        if (mask[i]) { N[i] = run; run++; } else run = 0;
      }
      run = 0;
      for (y = h - 1; y >= 0; y--) {
        i = y * w + x;
        if (mask[i]) { S[i] = run; run++; } else run = 0;
      }
    }
    return { N: N, S: S, E: E, W: W };
  }

  /* L-crook at (x,y), or null. Always kind "ell". */
  function classifyEll(mask, maps, w, h, x, y) {
    if (!mask[y * w + x]) return null;

    var N = maps.N[y * w + x], S = maps.S[y * w + x];
    var E = maps.E[y * w + x], W = maps.W[y * w + x];

    var trials = [
      { a: N, b: W, o1: S, o2: E, ox: 1, oy: 1 },
      { a: N, b: E, o1: S, o2: W, ox: -1, oy: 1 },
      { a: S, b: W, o1: N, o2: E, ox: 1, oy: -1 },
      { a: S, b: E, o1: N, o2: W, ox: -1, oy: -1 }
    ];

    var best = null, bestScore = 0, t, i;
    for (i = 0; i < trials.length; i++) {
      t = trials[i];
      if (t.a < 4 || t.b < 4) continue;
      if (Math.min(t.o1, t.o2) < Math.max(t.o1, t.o2) * 0.7) continue;
      var unit = (t.o1 + t.o2) / 2;
      if (unit < MIN_WIDTH || unit > MAX_WIDTH) continue;
      if (t.o1 < unit * OPEN_MIN || t.o2 < unit * OPEN_MIN) continue;
      if (t.o1 > unit * OPEN_MAX || t.o2 > unit * OPEN_MAX) continue;
      if (t.a < unit * ARM_MIN || t.b < unit * ARM_MIN) continue;
      if (t.a > unit * 14 || t.b > unit * 14) continue;

      var score = Math.min(t.a, t.b) / unit;
      if (score > bestScore) {
        bestScore = score;
        best = { unit: unit, t: t };
      }
    }
    if (!best) return null;

    var pad = Math.round(best.unit + 2);
    var ex = x + best.t.ox * pad, ey = y + best.t.oy * pad;
    if (ex < 0 || ey < 0 || ex >= w || ey >= h) return null;

    return { kind: 'ell', width: best.unit, ox: best.t.ox, oy: best.t.oy };
  }

  /* Is this five-run window a 1:1:1:1:1 alignment cross-section? */
  function isAlign(a, b, c, d, e) {
    var unit = (a + b + c + d + e) / 5;
    if (unit < MIN_WIDTH) return 0;
    var lo = unit * (1 - RUN_TOL), hi = unit * (1 + RUN_TOL);
    if (a < lo || a > hi || b < lo || b > hi || c < lo || c > hi ||
        d < lo || d > hi || e < lo || e > hi) return 0;
    return unit;
  }

  function scanAlignAxis(mask, w, h, vertical, hits) {
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

      var firstDark = mask[base] === 1;
      for (var k = 1; k + 5 < n; k++) {
        if ((k % 2 === 0) !== firstDark) continue;
        var unit = isAlign(len[k], len[k + 1], len[k + 2], len[k + 3], len[k + 4]);
        if (!unit) continue;
        var mid = at[k + 2] + len[k + 2] / 2;
        hits.push(vertical ? i + 0.5 : mid, vertical ? mid : i + 0.5,
                  unit, 1, 0, 0, vertical ? 1 : 0);
      }
    }
  }

  function hitStore() {
    return {
      n: 0, x: [], y: [], module: [], tee: [], ox: [], oy: [], vertical: [],
      push: function (x, y, module, tee, ox, oy, vertical) {
        if (this.n >= MAX_HITS) return;
        this.x.push(x); this.y.push(y); this.module.push(module);
        this.tee.push(tee); this.ox.push(ox); this.oy.push(oy);
        this.vertical.push(vertical);
        this.n++;
      }
    };
  }

  function cluster(hits) {
    var out = [];
    for (var i = 0; i < hits.n; i++) {
      var x = hits.x[i], y = hits.y[i], m = hits.module[i];
      var tol = m * 3, best = null, bestD = Infinity;
      for (var c = 0; c < out.length; c++) {
        var g = out[c];
        var cx = g.sx / g.n, cy = g.sy / g.n;
        if (Math.abs(cx - x) > tol || Math.abs(cy - y) > tol) continue;
        if (g.tee !== hits.tee[i]) continue;
        if (g.sm / g.n > m * 2.5 || m > (g.sm / g.n) * 2.5) continue;
        var d = (cx - x) * (cx - x) + (cy - y) * (cy - y);
        if (d < bestD) { bestD = d; best = g; }
      }
      if (!best) {
        best = { sx: 0, sy: 0, sm: 0, n: 0, tee: hits.tee[i], sox: 0, soy: 0, nv: 0, nh: 0 };
        out.push(best);
      }
      best.sx += x; best.sy += y; best.sm += m; best.n++;
      best.sox += hits.ox[i]; best.soy += hits.oy[i];
      if (hits.vertical[i]) best.nv++; else best.nh++;
    }
    return out;
  }

  function midlines(mask, maps, w, h, cx, cy, ox, oy, module) {
    if (!ox || !oy || module < MIN_WIDTH) {
      return { x: cx + (ox || 0) * module * 0.5, y: cy + (oy || 0) * module * 0.5 };
    }

    var vxs = [], hys = [], s, ax, ay, lo, hi, i;
    var vDir = -oy, hDir = -ox;

    for (s = Math.max(2, Math.round(module * 0.8)); s <= Math.round(module * 5); s++) {
      ay = Math.round(cy + vDir * s);
      ax = Math.round(cx - ox * module * 0.2);
      if (ay < 1 || ay >= h - 1 || ax < 1 || ax >= w - 1) continue;
      if (!mask[ay * w + ax]) {
        ax = Math.round(cx - ox * module * 0.6);
        if (ax < 1 || ax >= w - 1 || !mask[ay * w + ax]) continue;
      }
      lo = ax - maps.W[ay * w + ax];
      hi = ax + maps.E[ay * w + ax];
      if (hi - lo + 1 < module * 0.5 || hi - lo + 1 > module * 2.2) continue;
      vxs.push((lo + hi) * 0.5);
    }

    for (s = Math.max(2, Math.round(module * 0.8)); s <= Math.round(module * 5); s++) {
      ax = Math.round(cx + hDir * s);
      ay = Math.round(cy - oy * module * 0.2);
      if (ax < 1 || ax >= w - 1 || ay < 1 || ay >= h - 1) continue;
      if (!mask[ay * w + ax]) {
        ay = Math.round(cy - oy * module * 0.6);
        if (ay < 1 || ay >= h - 1 || !mask[ay * w + ax]) continue;
      }
      lo = ay - maps.N[ay * w + ax];
      hi = ay + maps.S[ay * w + ax];
      if (hi - lo + 1 < module * 0.5 || hi - lo + 1 > module * 2.2) continue;
      hys.push((lo + hi) * 0.5);
    }

    if (vxs.length < 3 || hys.length < 3) {
      return { x: cx + ox * module * 0.5, y: cy + oy * module * 0.5 };
    }

    var mx = 0, my = 0;
    for (i = 0; i < vxs.length; i++) mx += vxs[i];
    for (i = 0; i < hys.length; i++) my += hys[i];
    return { x: mx / vxs.length, y: my / hys.length };
  }

  function centres(mask, w, h) {
    var maps = runMaps(mask, w, h);
    var hits = hitStore();
    var band = Math.max(48, Math.round(Math.min(w, h) * 0.22));

    for (var y = 1; y < h - 1; y++) {
      var edgeRow = y < band || y >= h - band;
      for (var x = 1; x < w - 1; x++) {
        if (!edgeRow && x >= band && x < w - band) continue;
        if (!mask[y * w + x]) continue;
        if (hits.n >= MAX_HITS) break;
        var c = classifyEll(mask, maps, w, h, x, y);
        if (c) hits.push(x + 0.5, y + 0.5, c.width, 0, c.ox, c.oy, 0);
      }
    }

    scanAlignAxis(mask, w, h, false, hits);
    scanAlignAxis(mask, w, h, true, hits);

    var mapped = cluster(hits)
      .filter(function (g) {
        if (g.tee) {
          if (g.nh < MIN_HITS || g.nv < MIN_HITS) return false;
          var ax = g.sx / g.n, ay = g.sy / g.n, am = g.sm / g.n;
          if (ax < am * 3 || ay < am * 3 || ax > w - am * 3 || ay > h - am * 3) return false;
          return true;
        }
        return g.n >= MIN_HITS;
      })
      .map(function (g) {
        var m = g.sm / g.n;
        if (g.tee) {
          return {
            x: g.sx / g.n, y: g.sy / g.n, module: m,
            kind: 'tee', support: Math.min(g.nh, g.nv), ox: 0, oy: 0
          };
        }
        var ox = Math.sign(g.sox) || 0;
        var oy = Math.sign(g.soy) || 0;
        var refined = midlines(mask, maps, w, h, g.sx / g.n, g.sy / g.n, ox, oy, m);
        return {
          x: refined.x, y: refined.y, module: m,
          kind: 'ell', support: g.n, ox: ox, oy: oy
        };
      });

    /* Alignment-square corners look like tiny L crooks; drop any ell that
     * sits inside an alignment mark's neighbourhood. */
    var tees = mapped.filter(function (c) { return c.kind === 'tee'; });
    mapped = mapped.filter(function (c) {
      if (c.kind === 'tee') return true;
      for (var i = 0; i < tees.length; i++) {
        if (Math.hypot(c.x - tees[i].x, c.y - tees[i].y) < tees[i].module * 8) return false;
      }
      return true;
    });

    return mapped.sort(function (a, b) { return b.support - a.support; });
  }

  function classify(mask, w, h, x, y) {
    return classifyEll(mask, runMaps(mask, w, h), w, h, x, y);
  }

  PS.finder = { centres: centres, classify: classify };
})(window.PS);
