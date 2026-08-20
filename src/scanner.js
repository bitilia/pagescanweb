/* PageScan — reading a photographed or flatbed-scanned sheet back in.
 *
 * Detection is a straight search for the four registration patterns:
 *   1. shrink the frame to a working size where a 2.2mm module is still
 *      several pixels across, and binarise it with the same Sauvola threshold
 *      the cleaning stage uses;
 *   2. hunt every row and column for the 1:1:3:1:1 (finder) and 1:1:1:1:1
 *      (alignment) run patterns, and keep the spots where rows and columns
 *      agree — see finder.js;
 *   3. pick the four that best describe a sheet, name them from the alignment
 *      square (which sits at BR and nowhere else), and re-read each one from a
 *      tight native-resolution crop so the fiducials carry full precision.
 * If the first working size finds fewer than four, try the others.
 *
 * The markers carry no data, so the paper size cannot be read off the page —
 * A4, A5 and A3 are the same shape. It is passed in. Orientation, and which
 * corner is which, are recovered from the geometry. */
window.PS = window.PS || {};
(function (PS) {
  'use strict';

  /* Working resolutions, as a long-side pixel cap. 1100 puts a 2.2mm module
   * near 4px on A4; 1600 helps large paper, where a marker is a smaller
   * fraction of the sheet; 800 trades resolution for the noise suppression
   * that area-averaging down gives you. */
  var WORK_SCALES = [1100, 1600, 800];
  var EDGE_TRIM_MM = 1.2;    // photographed sheets carry a dark rim; drop it
  var BUDGET_MS = 6000;
  var MAX_CANDIDATES = 8;    // enough for four markers and a few false alarms
  var DEFAULT_PAPER = 'A4';

  function cropRGBA(img, x, y, w, h) {
    x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y));
    w = Math.min(Math.round(w), img.width - x);
    h = Math.min(Math.round(h), img.height - y);
    if (w <= 0 || h <= 0) return null;
    var out = new Uint8ClampedArray(w * h * 4);
    for (var j = 0; j < h; j++) {
      var s = ((y + j) * img.width + x) * 4;
      out.set(img.data.subarray(s, s + w * 4), j * w * 4);
    }
    return { data: out, width: w, height: h, ox: x, oy: y };
  }

  /* Fractional box-filter resample. Averaging down is not just about speed:
   * it suppresses sensor noise, which is often what stands between a marker
   * and a clean threshold in a dim photograph. Pure JS, so the pipeline
   * behaves identically in tests and in the browser. */
  function resampleRGBA(img, scale) {
    if (scale >= 0.999) return img;
    var w = Math.max(1, Math.round(img.width * scale));
    var h = Math.max(1, Math.round(img.height * scale));
    var out = new Uint8ClampedArray(w * h * 4);
    var sx = img.width / w, sy = img.height / h;
    for (var y = 0; y < h; y++) {
      var y0 = Math.floor(y * sy), y1 = Math.min(img.height, Math.max(y0 + 1, Math.ceil((y + 1) * sy)));
      for (var x = 0; x < w; x++) {
        var x0 = Math.floor(x * sx), x1 = Math.min(img.width, Math.max(x0 + 1, Math.ceil((x + 1) * sx)));
        var r = 0, g = 0, b = 0, n = 0;
        for (var yy = y0; yy < y1; yy++) {
          var base = (yy * img.width + x0) * 4;
          for (var xx = x0; xx < x1; xx++) {
            r += img.data[base]; g += img.data[base + 1]; b += img.data[base + 2];
            base += 4; n++;
          }
        }
        var o = (y * w + x) * 4;
        out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
      }
    }
    return { data: out, width: w, height: h, ox: img.ox, oy: img.oy };
  }

  /* Ink mask for pattern hunting. A local threshold is what lets the same
   * frame hold a bright window and a shadowed corner. */
  function inkMask(img, radius) {
    var gray = PS.geom.toGray(img);
    return PS.geom.sauvola(gray, img.width, img.height, radius, 0.2);
  }

  /* Everything the finder saw in one frame, in source-image coordinates. */
  function candidates(img, longSide) {
    var scale = Math.min(1, longSide / Math.max(img.width, img.height));
    var work = resampleRGBA(img, scale);
    var back = img.width / work.width;
    var radius = Math.max(8, Math.round(Math.max(work.width, work.height) / 40));
    var found = PS.finder.centres(inkMask(work, radius), work.width, work.height);
    return found.slice(0, MAX_CANDIDATES).map(function (c) {
      return {
        x: (img.ox || 0) + c.x * back, y: (img.oy || 0) + c.y * back,
        module: c.module * back, kind: c.kind, support: c.support
      };
    });
  }

  function cross(ax, ay, bx, by) { return ax * by - ay * bx; }

  /* Name the markers. The alignment square is printed at one corner only, so
   * finding it fixes the sheet's rotation outright; the rest follow from the
   * winding order, which a photograph preserves because paper cannot be
   * mirrored. Without it, the top-left finder is the one whose two neighbours
   * subtend a right angle. */
  function assign(points) {
    var aligns = points.filter(function (p) { return p.kind === 'align'; });
    var finders = points.filter(function (p) { return p.kind === 'finder'; });
    var hits = {}, i;

    function vec(from, to) { return { x: to.x - from.x, y: to.y - from.y }; }

    if (aligns.length && finders.length >= 2) {
      var br = aligns[0];
      var us = finders.slice(0, 3).map(function (f) { return { p: f, u: vec(br, f) }; });
      hits.BR = br;

      if (us.length === 3) {
        us.sort(function (a, b) { return Math.hypot(b.u.x, b.u.y) - Math.hypot(a.u.x, a.u.y); });
        hits.TL = us[0].p;
        var s = cross(us[1].u.x, us[1].u.y, us[2].u.x, us[2].u.y);
        hits.TR = s < 0 ? us[1].p : us[2].p;
        hits.BL = s < 0 ? us[2].p : us[1].p;
        return hits;
      }

      var a = us[0], b = us[1];
      var la = Math.hypot(a.u.x, a.u.y), lb = Math.hypot(b.u.x, b.u.y);
      if (!la || !lb) return null;
      var cosang = (a.u.x * b.u.x + a.u.y * b.u.y) / (la * lb);
      if (Math.abs(cosang) < 0.45) {          // both are side corners
        var t = cross(a.u.x, a.u.y, b.u.x, b.u.y);
        hits.TR = t < 0 ? a.p : b.p;
        hits.BL = t < 0 ? b.p : a.p;
      } else {                                 // the long one is the diagonal
        var tl = la >= lb ? a : b, other = la >= lb ? b : a;
        hits.TL = tl.p;
        hits[cross(tl.u.x, tl.u.y, other.u.x, other.u.y) > 0 ? 'TR' : 'BL'] = other.p;
      }
      return hits;
    }

    if (finders.length >= 3) {
      var f = finders.slice(0, 3), bestI = -1, bestErr = Infinity;
      for (i = 0; i < 3; i++) {
        var u = vec(f[i], f[(i + 1) % 3]), v = vec(f[i], f[(i + 2) % 3]);
        var lu = Math.hypot(u.x, u.y), lv = Math.hypot(v.x, v.y);
        if (!lu || !lv) return null;
        var err = Math.abs((u.x * v.x + u.y * v.y) / (lu * lv));   // |cos|, 0 at 90°
        if (err < bestErr) { bestErr = err; bestI = i; }
      }
      var tlp = f[bestI], p = f[(bestI + 1) % 3], q = f[(bestI + 2) % 3];
      hits.TL = tlp;
      var w = cross(p.x - tlp.x, p.y - tlp.y, q.x - tlp.x, q.y - tlp.y);
      hits.TR = w > 0 ? p : q;
      hits.BL = w > 0 ? q : p;
      return hits;
    }

    return null;
  }

  function quadArea(pts) {
    var a = 0;
    for (var i = 0; i < pts.length; i++) {
      var j = (i + 1) % pts.length;
      a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    return Math.abs(a) / 2;
  }

  /* Score a naming: the four markers sit at the corners of the sheet, so the
   * right answer is the one that encloses the most page — weighted down when
   * the markers disagree about how big a module is, which is what a false
   * alarm somewhere off the sheet looks like. */
  function score(hits) {
    var order = PS.CORNERS.filter(function (c) { return hits[c]; });
    if (order.length < 3) return 0;
    var pts = order.map(function (c) { return hits[c]; });
    var lo = Infinity, hi = 0;
    pts.forEach(function (p) { lo = Math.min(lo, p.module); hi = Math.max(hi, p.module); });
    if (!hi) return 0;
    return quadArea(pts) * (lo / hi) * (order.length === 4 ? 1.6 : 1);
  }

  /* Choose the best three or four of everything the finder reported. */
  function choose(cands) {
    if (cands.length < 3) return cands.length ? { hits: null, points: cands } : null;

    var best = null, bestScore = 0;
    var n = Math.min(cands.length, MAX_CANDIDATES);
    var combos = [];
    for (var a = 0; a < n; a++) {
      for (var b = a + 1; b < n; b++) {
        for (var c = b + 1; c < n; c++) {
          combos.push([cands[a], cands[b], cands[c]]);
          for (var d = c + 1; d < n; d++) combos.push([cands[a], cands[b], cands[c], cands[d]]);
        }
      }
    }
    for (var i = 0; i < combos.length; i++) {
      var hits = assign(combos[i]);
      if (!hits) continue;
      var s = score(hits);
      if (s > bestScore) { bestScore = s; best = hits; }
    }
    return best ? { hits: best } : { hits: null, points: cands.slice(0, 4) };
  }

  /* Which way up the sheet is: compare a horizontal marker span with a
   * vertical one. Every three-marker subset offers one of each. */
  function orientationOf(hits) {
    function span(a, b) {
      return hits[a] && hits[b] ? Math.hypot(hits[a].x - hits[b].x, hits[a].y - hits[b].y) : 0;
    }
    var across = span('TL', 'TR') || span('BL', 'BR');
    var down = span('TL', 'BL') || span('TR', 'BR');
    if (!across || !down) return null;
    return across > down ? 'L' : 'P';
  }

  /* Re-read one marker from a tight native crop, where a module is tens of
   * pixels rather than four, and take the centre from that. */
  function refine(img, hit, corner) {
    var pad = hit.module * 12;
    var region = cropRGBA(img, hit.x - pad, hit.y - pad, pad * 2, pad * 2);
    if (!region || region.width < 24 || region.height < 24) return;
    var radius = Math.max(6, Math.round(hit.module * 3));
    var found = PS.finder.centres(inkMask(region, radius), region.width, region.height);
    var want = PS.markKind(corner), tol = hit.module * 3;
    for (var i = 0; i < found.length; i++) {
      var c = found[i];
      var x = region.ox + c.x, y = region.oy + c.y;
      if (c.kind !== want) continue;
      if (Math.abs(x - hit.x) > tol || Math.abs(y - hit.y) > tol) continue;
      hit.x = x; hit.y = y; hit.module = c.module; hit.refined = true;
      return;
    }
  }

  function result(paper, orientation, hits, reason) {
    var found = PS.CORNERS.filter(function (c) { return hits && hits[c]; });
    if (found.length >= 3 && !orientation) reason = 'collinear';
    return {
      ok: found.length >= 3 && !!orientation,
      reason: found.length >= 3 && orientation ? null : (reason || (found.length ? 'need-three' : 'no-markers')),
      paper: paper, orientation: orientation,
      found: found,
      missing: PS.CORNERS.filter(function (c) { return found.indexOf(c) < 0; }),
      hits: hits || {},
      exact: found.length === 4
    };
  }

  function detect(img, opts) {
    opts = opts || {};
    var paper = PS.PAPER[opts.paper] ? opts.paper : DEFAULT_PAPER;
    var deadline = Date.now() + (opts.budgetMs || BUDGET_MS);
    var hits = null, seen = 0;

    for (var i = 0; i < WORK_SCALES.length; i++) {
      var cands = candidates(img, WORK_SCALES[i]);
      seen = Math.max(seen, cands.length);
      var picked = choose(cands);
      if (picked && picked.hits) {
        hits = picked.hits;
        if (PS.CORNERS.filter(function (c) { return hits[c]; }).length === 4) break;
      }
      if (Date.now() > deadline) break;
    }

    if (!hits) return result(paper, null, null, seen ? 'need-three' : 'no-markers');

    PS.CORNERS.forEach(function (corner) {
      if (hits[corner]) refine(img, hits[corner], corner);
    });

    return result(paper, orientationOf(hits), hits);
  }

  /* How many source pixels cover one millimetre of paper, averaged over the
   * detected edges. Upsampling past this only inflates the file. */
  function sourceScale(detection) {
    var fid = PS.fiducials(detection.paper, detection.orientation);
    var pairs = [['TL', 'TR'], ['TR', 'BR'], ['BR', 'BL'], ['BL', 'TL']];
    var total = 0, count = 0;
    pairs.forEach(function (pair) {
      if (detection.found.indexOf(pair[0]) < 0 || detection.found.indexOf(pair[1]) < 0) return;
      var a = detection.hits[pair[0]], b = detection.hits[pair[1]];
      var mm = Math.hypot(fid[pair[0]].x - fid[pair[1]].x, fid[pair[0]].y - fid[pair[1]].y);
      if (mm > 1) { total += Math.hypot(a.x - b.x, a.y - b.y) / mm; count++; }
    });
    return count ? total / count : 8;
  }

  /* Rectify to a page-aligned ink mask at the requested (capped) resolution. */
  function rectify(img, detection, opts) {
    opts = opts || {};
    var sheet = PS.sheetSize(detection.paper, detection.orientation);
    var fid = PS.fiducials(detection.paper, detection.orientation);
    var corners = detection.found;
    var pagePts = corners.map(function (c) { return fid[c]; });
    var imgPts = corners.map(function (c) { return detection.hits[c]; });

    var H = corners.length >= 4
      ? PS.geom.homography(pagePts.slice(0, 4), imgPts.slice(0, 4))
      : PS.geom.affine(pagePts.slice(0, 3), imgPts.slice(0, 3));
    if (!H) return null;

    var pxPerMm = sourceScale(detection);
    var nativeDpi = pxPerMm * 25.4;
    /* A little headroom above native keeps thin pen strokes from aliasing,
     * but chasing detail the photo never captured just inflates the file. */
    var dpi = Math.max(120, Math.min(opts.dpi || 200, Math.round(nativeDpi * 1.15)));
    var scale = dpi / 25.4;
    var outW = Math.max(8, Math.round(sheet.w * scale));
    var outH = Math.max(8, Math.round(sheet.h * scale));

    var gray = PS.geom.toGray(img);
    var warped = PS.geom.warpGray(gray, img.width, img.height, H, outW, outH, 1 / scale, 1 / scale);

    var strength = opts.strength == null ? 50 : opts.strength;
    /* Slider 0..100 -> white point 0.62..0.94 of the local paper level. Low
     * keeps only confident ink (and can wash printed rules away); high keeps
     * faint pencil. Everything under the white point is kept as grey, not
     * thresholded, and the black point is what the darkest ink is stretched to. */
    var white = 0.62 + (strength / 100) * 0.32;
    var black = white * 0.42;

    var block = Math.max(8, Math.round(4 * scale));   // ~4mm of paper
    var image = PS.geom.tone(warped, PS.geom.background(warped, outW, outH, block, 0.92),
                             white, black);

    /* Anything that is not paper, for despeckling and for the tests. */
    var mask = new Uint8Array(outW * outH);
    for (var i = 0; i < mask.length; i++) mask[i] = image[i] < 250 ? 1 : 0;

    if (opts.despeckle !== false) {
      /* 0.08 mm^2 — a dot roughly a third of a millimetre across. */
      PS.geom.despeckle(mask, outW, outH, Math.max(2, Math.round(0.08 * scale * scale)));
      for (i = 0; i < mask.length; i++) if (!mask[i]) image[i] = 255;
    }

    function clearRect(x0, y0, x1, y1) {
      x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
      x1 = Math.min(outW, Math.ceil(x1)); y1 = Math.min(outH, Math.ceil(y1));
      for (var y = y0; y < y1; y++) {
        var from = y * outW + x0, to = y * outW + x1;
        mask.fill(0, from, to);
        image.fill(255, from, to);
      }
    }

    /* The sheet's own edge casts a shadow in any photograph; a hairline of
     * trim removes the black rim without touching anything written. */
    var trim = EDGE_TRIM_MM * scale;
    clearRect(0, 0, outW, trim);
    clearRect(0, outH - trim, outW, outH);
    clearRect(0, 0, trim, outH);
    clearRect(outW - trim, 0, outW, outH);

    if (opts.hideMarkers !== false) {
      PS.keepouts(detection.paper, detection.orientation).forEach(function (ko) {
        clearRect((ko.x - 1) * scale, (ko.y - 1) * scale,
                  (ko.x + ko.w + 1) * scale, (ko.y + ko.h + 1) * scale);
      });
    }

    return {
      image: image, mask: mask, width: outW, height: outH, sheet: sheet, dpi: dpi,
      nativeDpi: Math.round(nativeDpi), gray: warped,
      paper: detection.paper, orientation: detection.orientation,
      exact: !!detection.exact
    };
  }

  PS.scanner = {
    detect: detect, rectify: rectify, cropRGBA: cropRGBA, resampleRGBA: resampleRGBA,
    sourceScale: sourceScale, candidates: candidates, assign: assign, inkMask: inkMask
  };
})(window.PS);
