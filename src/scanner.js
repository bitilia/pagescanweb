/* PageScan — reading a photographed or flatbed-scanned sheet back in.
 *
 * jsQR finds one symbol per call and a page photo can be 12 megapixels, so
 * detection is staged:
 *   1. sweep four overlapping quadrants, downscaled to a size where a 15mm
 *      marker still spans about 4px per module;
 *   2. once two markers are known the page's pose is roughly determined, so
 *      predict where the missing ones must be and read those small windows at
 *      native resolution — far cheaper and surer than blind tiling;
 *   3. if corners are still missing, repeat at the next sweep resolution.
 * Every hit is finally re-read from a tight native crop, so the fiducials
 * carry full-resolution precision no matter which pass found them, and the
 * whole search runs under a time budget. */
window.PS = window.PS || {};
(function (PS) {
  'use strict';

  /* Successive sweep resolutions, as a long-side pixel cap. 1400 keeps a
   * 15mm marker near 4px per module on A4; 2000 helps large paper where the
   * marker is a smaller fraction of the sheet; 900 trades resolution for the
   * noise suppression that area-averaging down gives you. */
  var SWEEP_SCALES = [1400, 2000, 900];
  var QUAD_OVERLAP = 0.62;   // each quadrant covers 62% of each axis
  var EDGE_TRIM_MM = 1.2;    // photographed sheets carry a dark rim; drop it
  /* jsQR is quick when it finds a symbol and slow when it does not, roughly
   * linear in pixels. Without a ceiling, a photo containing no markers at all
   * could grind for a minute; this bounds that to something explainable. */
  var BUDGET_MS = 9000;

  /* The fiducial is whichever corner of the symbol faces away from the page
   * centre — the one point per marker whose page-mm position we know. */
  var OUTWARD = {
    TL: 'topLeftCorner', TR: 'topRightCorner',
    BR: 'bottomRightCorner', BL: 'bottomLeftCorner'
  };

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
   * it suppresses sensor noise, which is often what stands between jsQR and
   * a readable symbol in a dim photograph. Pure JS, so the pipeline behaves
   * identically in tests and in the browser. */
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

  function symbolBox(loc) {
    var pts = [loc.topLeftCorner, loc.topRightCorner, loc.bottomRightCorner, loc.bottomLeftCorner];
    var xs = pts.map(function (p) { return p.x; }), ys = pts.map(function (p) { return p.y; });
    var minX = Math.min.apply(null, xs), minY = Math.min.apply(null, ys);
    return { x: minX, y: minY, w: Math.max.apply(null, xs) - minX, h: Math.max.apply(null, ys) - minY };
  }

  /* Read one rectangle of the source image, resampling down if it is larger
   * than jsQR needs. Coordinates come back in source-image space.
   * Markers are always printed dark on white, so inversion is off by default;
   * it is only worth the doubled cost on the small windows. */
  function scanRegion(img, rect, maxDim, tryInverted) {
    var region = cropRGBA(img, rect.x, rect.y, rect.w, rect.h);
    if (!region) return null;
    var scale = Math.min(1, maxDim / Math.max(region.width, region.height));
    var work = resampleRGBA(region, scale);
    var res;
    try {
      res = jsQR(work.data, work.width, work.height, {
        inversionAttempts: tryInverted ? 'attemptBoth' : 'dontInvert'
      });
    } catch (e) { return null; }
    if (!res) return null;
    var decoded = PS.decodePayload(res.data);
    if (!decoded) return null;
    var back = region.width / work.width;
    return { decoded: decoded, location: res.location, ox: region.ox, oy: region.oy, scale: back };
  }

  function record(hits, hit) {
    var box = symbolBox(hit.location);
    var size = Math.max(box.w, box.h) * hit.scale;
    var corner = hit.decoded.corner;
    if (hits[corner] && hits[corner].size >= size) return;
    hits[corner] = {
      corner: corner,
      paper: hit.decoded.paper,
      orientation: hit.decoded.orientation,
      point: {
        x: hit.ox + hit.location[OUTWARD[corner]].x * hit.scale,
        y: hit.oy + hit.location[OUTWARD[corner]].y * hit.scale
      },
      box: {
        x: hit.ox + box.x * hit.scale, y: hit.oy + box.y * hit.scale,
        w: box.w * hit.scale, h: box.h * hit.scale
      },
      size: size
    };
  }

  function quadrants(w, h) {
    var qw = w * QUAD_OVERLAP, qh = h * QUAD_OVERLAP;
    return [
      { x: 0, y: 0, w: qw, h: qh },
      { x: w - qw, y: 0, w: qw, h: qh },
      { x: w - qw, y: h - qh, w: qw, h: qh },
      { x: 0, y: h - qh, w: qw, h: qh }
    ];
  }

  function sweep(img, regions, maxDim, hits, deadline) {
    for (var i = 0; i < regions.length; i++) {
      if (Object.keys(hits).length === 4) return;
      if (Date.now() > deadline) return;
      var hit = scanRegion(img, regions[i], maxDim, false);
      if (hit) record(hits, hit);
    }
  }

  /* Rough page-mm -> image-px pose from the markers found so far.
   * Three points give an exact affine; two give a similarity, which is enough
   * to aim a search window even when the shot is angled. */
  function pose(pagePts, imgPts) {
    if (pagePts.length >= 3) {
      var A = PS.geom.affine(pagePts.slice(0, 3), imgPts.slice(0, 3));
      if (!A) return null;
      return {
        map: function (p) { return { x: A[0] * p.x + A[1] * p.y + A[2], y: A[3] * p.x + A[4] * p.y + A[5] }; },
        pxPerMm: Math.sqrt(Math.abs(A[0] * A[4] - A[1] * A[3])) || 1
      };
    }
    if (pagePts.length === 2) {
      var pd = { x: pagePts[1].x - pagePts[0].x, y: pagePts[1].y - pagePts[0].y };
      var id = { x: imgPts[1].x - imgPts[0].x, y: imgPts[1].y - imgPts[0].y };
      var den = pd.x * pd.x + pd.y * pd.y;
      if (den < 1e-6) return null;
      /* Complex division: the rotation+scale taking one page vector to the other. */
      var zr = (id.x * pd.x + id.y * pd.y) / den;
      var zi = (id.y * pd.x - id.x * pd.y) / den;
      return {
        map: function (p) {
          var dx = p.x - pagePts[0].x, dy = p.y - pagePts[0].y;
          return { x: imgPts[0].x + zr * dx - zi * dy, y: imgPts[0].y + zi * dx + zr * dy };
        },
        pxPerMm: Math.hypot(zr, zi) || 1
      };
    }
    return null;
  }

  function agreedSet(hits) {
    var found = PS.CORNERS.filter(function (c) { return hits[c]; });
    if (!found.length) return { found: [], paper: null, orientation: null };
    var tally = Object.create(null), best = null;
    found.forEach(function (c) {
      var key = hits[c].paper + hits[c].orientation;
      tally[key] = (tally[key] || 0) + 1;
      if (!best || tally[key] > tally[best]) best = key;
    });
    var paper = best.slice(0, 2), orientation = best.slice(2);
    return {
      paper: paper, orientation: orientation,
      found: found.filter(function (c) {
        return hits[c].paper === paper && hits[c].orientation === orientation;
      })
    };
  }

  /* Aim a native-resolution read at each corner we haven't got yet. */
  function predictMissing(img, hits) {
    var set = agreedSet(hits);
    if (set.found.length < 2 || set.found.length === 4) return;
    var origins = PS.markOrigins(set.paper, set.orientation);
    var fid = PS.fiducials(set.paper, set.orientation);
    var half = PS.MARK.size / 2;

    var p = pose(
      set.found.map(function (c) { return fid[c]; }),
      set.found.map(function (c) { return hits[c].point; })
    );
    if (!p) return;

    PS.CORNERS.forEach(function (corner) {
      if (hits[corner]) return;
      var centre = { x: origins[corner].x + half, y: origins[corner].y + half };
      var at = p.map(centre);
      var span = PS.MARK.size * p.pxPerMm * 3.2;
      var hit = scanRegion(img, { x: at.x - span / 2, y: at.y - span / 2, w: span, h: span },
                           SWEEP_SCALES[0], true);
      if (hit && hit.decoded.corner === corner) record(hits, hit);
    });
  }

  function detect(img, opts) {
    opts = opts || {};
    var hits = Object.create(null);
    var deadline = Date.now() + (opts.budgetMs || BUDGET_MS);
    var regions = quadrants(img.width, img.height);

    /* Try each sweep resolution in turn, letting the predictive pass close
     * the gap after every one — two markers are usually enough to aim at
     * the rest, which is far cheaper than sweeping again. */
    for (var i = 0; i < SWEEP_SCALES.length; i++) {
      sweep(img, regions, SWEEP_SCALES[i], hits, deadline);
      predictMissing(img, hits);
      if (agreedSet(hits).found.length === 4) break;
      if (Date.now() > deadline) break;
    }

    /* Re-read every hit from a tight native crop for maximum corner precision. */
    Object.keys(hits).forEach(function (corner) {
      var hit = hits[corner];
      var pad = Math.max(hit.box.w, hit.box.h) * 0.45;
      var refined = scanRegion(img, {
        x: hit.box.x - pad, y: hit.box.y - pad,
        w: hit.box.w + pad * 2, h: hit.box.h + pad * 2
      }, Infinity, true);
      if (!refined || refined.decoded.corner !== corner || refined.scale !== 1) return;
      var p = refined.location[OUTWARD[corner]];
      hit.point = { x: refined.ox + p.x, y: refined.oy + p.y };
      hit.refined = true;
    });

    var set = agreedSet(hits);
    if (!set.found.length) {
      return { ok: false, reason: 'no-markers', found: [], missing: PS.CORNERS.slice(), hits: hits };
    }
    return {
      ok: set.found.length >= 3,
      reason: set.found.length >= 3 ? null : 'need-three',
      paper: set.paper,
      orientation: set.orientation,
      found: set.found,
      missing: PS.CORNERS.filter(function (c) { return set.found.indexOf(c) < 0; }),
      hits: hits,
      exact: set.found.length === 4
    };
  }

  /* How many source pixels cover one millimetre of paper, averaged over the
   * detected edges. Upsampling past this only inflates the file. */
  function sourceScale(detection) {
    var fid = PS.fiducials(detection.paper, detection.orientation);
    var pairs = [['TL', 'TR'], ['TR', 'BR'], ['BR', 'BL'], ['BL', 'TL']];
    var total = 0, count = 0;
    pairs.forEach(function (pair) {
      if (detection.found.indexOf(pair[0]) < 0 || detection.found.indexOf(pair[1]) < 0) return;
      var a = detection.hits[pair[0]].point, b = detection.hits[pair[1]].point;
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
    var imgPts = corners.map(function (c) { return detection.hits[c].point; });

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
    /* Slider 0..100 -> Sauvola k 0.45..0.05. Low k keeps faint marks (and
     * printed rules); high k keeps only confident ink. */
    var k = 0.45 - (strength / 100) * 0.40;
    var mask = PS.geom.sauvola(warped, outW, outH, Math.max(6, Math.round(outW / 40)), k);

    if (opts.despeckle !== false) {
      /* 0.08 mm^2 — a dot roughly a third of a millimetre across. */
      PS.geom.despeckle(mask, outW, outH, Math.max(2, Math.round(0.08 * scale * scale)));
    }

    function clearRect(x0, y0, x1, y1) {
      x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
      x1 = Math.min(outW, Math.ceil(x1)); y1 = Math.min(outH, Math.ceil(y1));
      for (var y = y0; y < y1; y++) mask.fill(0, y * outW + x0, y * outW + x1);
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
      mask: mask, width: outW, height: outH, sheet: sheet, dpi: dpi,
      nativeDpi: Math.round(nativeDpi), gray: warped,
      paper: detection.paper, orientation: detection.orientation,
      exact: !!detection.exact
    };
  }

  PS.scanner = {
    detect: detect, rectify: rectify, cropRGBA: cropRGBA,
    resampleRGBA: resampleRGBA, sourceScale: sourceScale, scanRegion: scanRegion
  };
})(window.PS);
