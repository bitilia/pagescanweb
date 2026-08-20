/* PageScan — locating registration marks in a photograph.
 *
 * Each corner mark is an L (two thick arms along the page edges) or, at BR,
 * a T (the same L plus a short inward stem). The fiducial is the inner crook
 * where the arms meet.
 *
 * Detection walks every dark pixel of a binarised frame and asks whether the
 * four cardinal dark-runs out of that pixel look like a crook:
 *
 *   long dark along two neighbouring directions (the arms),
 *   short / open along the other two (the open diagonal),
 *   arm thickness near the stroke width.
 *
 * A T is the same crook with a third long dark run (the stem). One line
 * proves nothing, so a spot only counts when many neighbouring crook hits
 * cluster on it — averaging them lands the centre well inside a pixel.
 *
 * Four orientations of L are accepted; paper rotation in the photograph is
 * free. */
window.PS = window.PS || {};
(function (PS) {
  'use strict';

  var MIN_WIDTH = 1.5;     // px; below this a "stroke" is just sensor noise
  var MAX_WIDTH = 48;      // px; above this we are looking at a ruled block
  var ARM_MIN = 3.5;       // arms must be at least this many widths long
  var OPEN_MAX = 1.6;      // open directions may only run this many widths
  var RUN_TOL = 0.55;      // how far arm thickness may stray from the unit
  var MAX_HITS = 80000;
  var MIN_HITS = 4;        // minimum crook hits before a cluster is believed

  /* Contiguous dark length from (x,y) exclusive step in (dx,dy). */
  function run(mask, w, h, x, y, dx, dy) {
    var n = 0, cx = x + dx, cy = y + dy;
    while (cx >= 0 && cy >= 0 && cx < w && cy < h && mask[cy * w + cx]) {
      n++;
      cx += dx;
      cy += dy;
    }
    return n;
  }

  /* Thickness of a dark stroke measured perpendicular to an arm that leaves
   * the crook in direction (adx, ady). Sample a few steps along the arm and
   * average the short dark runs across it. */
  function thickness(mask, w, h, x, y, adx, ady) {
    var pdx = -ady, pdy = adx;   // perpendicular
    var sum = 0, n = 0, step;
    for (step = 2; step <= 8; step += 2) {
      var ax = x + adx * step, ay = y + ady * step;
      if (ax < 0 || ay < 0 || ax >= w || ay >= h || !mask[ay * w + ax]) continue;
      var a = run(mask, w, h, ax, ay, pdx, pdy);
      var b = run(mask, w, h, ax, ay, -pdx, -pdy);
      /* Include the centre pixel itself. */
      sum += a + b + 1;
      n++;
    }
    return n ? sum / n : 0;
  }

  /* Which shape, if any, the four cardinal dark-runs describe at (x, y).
   * Returns null or { kind, width, openX, openY }. open* is the unit vector
   * into the open diagonal (toward page centre for a true mark). */
  function classify(mask, w, h, x, y) {
    if (!mask[y * w + x]) return null;

    var N = run(mask, w, h, x, y, 0, -1);
    var S = run(mask, w, h, x, y, 0, 1);
    var E = run(mask, w, h, x, y, 1, 0);
    var W = run(mask, w, h, x, y, -1, 0);

    /* Four L orientations: the two long arms and the open quadrant. */
    var trials = [
      { a: N, b: W, o1: S, o2: E, adx: 0, ady: -1, bdx: -1, bdy: 0, ox: 1, oy: 1 },
      { a: N, b: E, o1: S, o2: W, adx: 0, ady: -1, bdx: 1, bdy: 0, ox: -1, oy: 1 },
      { a: S, b: W, o1: N, o2: E, adx: 0, ady: 1, bdx: -1, bdy: 0, ox: 1, oy: -1 },
      { a: S, b: E, o1: N, o2: W, adx: 0, ady: 1, bdx: 1, bdy: 0, ox: -1, oy: -1 }
    ];

    var best = null, bestScore = 0, t, i;
    for (i = 0; i < trials.length; i++) {
      t = trials[i];
      var ta = thickness(mask, w, h, x, y, t.adx, t.ady);
      var tb = thickness(mask, w, h, x, y, t.bdx, t.bdy);
      if (ta < MIN_WIDTH || tb < MIN_WIDTH) continue;
      var unit = (ta + tb) / 2;
      if (unit > MAX_WIDTH) continue;
      if (Math.abs(ta - tb) > unit * RUN_TOL) continue;

      if (t.a < unit * ARM_MIN || t.b < unit * ARM_MIN) continue;
      if (t.o1 > unit * OPEN_MAX || t.o2 > unit * OPEN_MAX) continue;

      /* Arms should not be wildly longer than the printed length (~6.4 widths),
       * but perspective and merged content can stretch a reading — keep a soft
       * ceiling so a full page-edge rule cannot pass as an arm. */
      if (t.a > unit * 14 || t.b > unit * 14) continue;

      var score = Math.min(t.a, t.b) / unit;
      if (score > bestScore) {
        bestScore = score;
        best = { unit: unit, t: t, N: N, S: S, E: E, W: W };
      }
    }
    if (!best) return null;

    unit = best.unit;
    t = best.t;

    /* A T places a stem block in the open content quadrant (opposite the two
     * short edge-through-thickness directions). Sample near the middle of
     * that block; ink there means we have a tee. */
    var reach = unit * (PS.MARK.stem / PS.MARK.width) * 0.45;
    var sx = Math.round(x - t.ox * reach);
    var sy = Math.round(y - t.oy * reach);
    var tee = sx >= 0 && sy >= 0 && sx < w && sy < h && !!mask[sy * w + sx];

    return {
      kind: tee ? 'tee' : 'ell',
      width: unit,
      ox: t.ox,
      oy: t.oy
    };
  }

  function hitStore() {
    return {
      n: 0, x: [], y: [], module: [], tee: [],
      push: function (x, y, module, tee) {
        if (this.n >= MAX_HITS) return;
        this.x.push(x); this.y.push(y); this.module.push(module);
        this.tee.push(tee);
        this.n++;
      }
    };
  }

  /* Gather crook hits that sit on top of each other. Every pixel around one
   * junction reports within about a stroke width of the true crook, and two
   * markers are never closer than a corner of the sheet is to another. */
  function cluster(hits) {
    var out = [];
    for (var i = 0; i < hits.n; i++) {
      var x = hits.x[i], y = hits.y[i], m = hits.module[i];
      var tol = m * 2.5, best = null, bestD = Infinity;
      for (var c = 0; c < out.length; c++) {
        var g = out[c];
        var cx = g.sx / g.n, cy = g.sy / g.n;
        if (Math.abs(cx - x) > tol || Math.abs(cy - y) > tol) continue;
        if (g.sm / g.n > m * 2.5 || m > (g.sm / g.n) * 2.5) continue;
        var d = (cx - x) * (cx - x) + (cy - y) * (cy - y);
        if (d < bestD) { bestD = d; best = g; }
      }
      if (!best) {
        best = { sx: 0, sy: 0, sm: 0, n: 0, tee: 0 };
        out.push(best);
      }
      best.sx += x; best.sy += y; best.sm += m; best.n++;
      best.tee += hits.tee[i];
    }
    return out;
  }

  /* Candidate markers in one binarised frame, strongest support first. */
  function centres(mask, w, h) {
    var hits = hitStore();
    /* Stride by ~half a minimum stroke so we still sample every crook several
     * times without visiting every pixel on a 1600px frame. */
    var step = 2;
    for (var y = 1; y < h - 1; y += step) {
      for (var x = 1; x < w - 1; x += step) {
        if (hits.n >= MAX_HITS) break;
        var c = classify(mask, w, h, x, y);
        if (!c) continue;
        hits.push(x + 0.5, y + 0.5, c.width, c.kind === 'tee' ? 1 : 0);
      }
    }

    return cluster(hits)
      .filter(function (g) { return g.n >= MIN_HITS; })
      .map(function (g) {
        return {
          x: g.sx / g.n, y: g.sy / g.n,
          module: g.sm / g.n,
          kind: g.tee * 2 >= g.n ? 'tee' : 'ell',
          support: g.n
        };
      })
      .sort(function (a, b) { return b.support - a.support; });
  }

  PS.finder = { centres: centres, classify: classify };
})(window.PS);
