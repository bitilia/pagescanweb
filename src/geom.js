/* PageScan — rectification maths.
 * The four marker fiducials give us an exact page-mm <-> photo-pixel
 * correspondence, so we can undo real perspective (a phone held at an angle),
 * not merely rotation. */
window.PS = window.PS || {};
(function (PS) {
  'use strict';

  /* Solve M x = y in place by Gaussian elimination with partial pivoting. */
  function solveLinear(M, y, n) {
    var i, j, k;
    for (i = 0; i < n; i++) {
      var pivot = i;
      for (j = i + 1; j < n; j++) {
        if (Math.abs(M[j * n + i]) > Math.abs(M[pivot * n + i])) pivot = j;
      }
      if (Math.abs(M[pivot * n + i]) < 1e-12) return null; // degenerate
      if (pivot !== i) {
        for (k = 0; k < n; k++) {
          var t = M[i * n + k]; M[i * n + k] = M[pivot * n + k]; M[pivot * n + k] = t;
        }
        var ty = y[i]; y[i] = y[pivot]; y[pivot] = ty;
      }
      for (j = i + 1; j < n; j++) {
        var f = M[j * n + i] / M[i * n + i];
        if (!f) continue;
        for (k = i; k < n; k++) M[j * n + k] -= f * M[i * n + k];
        y[j] -= f * y[i];
      }
    }
    var x = new Float64Array(n);
    for (i = n - 1; i >= 0; i--) {
      var s = y[i];
      for (j = i + 1; j < n; j++) s -= M[i * n + j] * x[j];
      x[i] = s / M[i * n + i];
    }
    return x;
  }

  /* Homography src -> dst from four correspondences.
   * Returns [a,b,c,d,e,f,g,h] with
   *   u = (a*x + b*y + c) / (g*x + h*y + 1)
   *   v = (d*x + e*y + f) / (g*x + h*y + 1)  */
  function homography(src, dst) {
    var M = new Float64Array(64), y = new Float64Array(8);
    for (var i = 0; i < 4; i++) {
      var s = src[i], d = dst[i], r = i * 2;
      M[r * 8 + 0] = s.x; M[r * 8 + 1] = s.y; M[r * 8 + 2] = 1;
      M[r * 8 + 6] = -s.x * d.x; M[r * 8 + 7] = -s.y * d.x;
      y[r] = d.x;
      r += 1;
      M[r * 8 + 3] = s.x; M[r * 8 + 4] = s.y; M[r * 8 + 5] = 1;
      M[r * 8 + 6] = -s.x * d.y; M[r * 8 + 7] = -s.y * d.y;
      y[r] = d.y;
    }
    return solveLinear(M, y, 8);
  }

  /* Affine fallback when only three markers survive: still corrects rotation,
   * scale, shear and translation, just not true perspective. */
  function affine(src, dst) {
    var M = new Float64Array(36), y = new Float64Array(6);
    for (var i = 0; i < 3; i++) {
      var s = src[i], d = dst[i], r = i * 2;
      M[r * 6 + 0] = s.x; M[r * 6 + 1] = s.y; M[r * 6 + 2] = 1; y[r] = d.x;
      r += 1;
      M[r * 6 + 3] = s.x; M[r * 6 + 4] = s.y; M[r * 6 + 5] = 1; y[r] = d.y;
    }
    var a = solveLinear(M, y, 6);
    if (!a) return null;
    return Float64Array.from([a[0], a[1], a[2], a[3], a[4], a[5], 0, 0]);
  }

  function apply(H, x, y) {
    var w = H[6] * x + H[7] * y + 1;
    return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w };
  }

  function toGray(imageData) {
    var d = imageData.data, n = imageData.width * imageData.height;
    var g = new Uint8ClampedArray(n);
    for (var i = 0, p = 0; i < n; i++, p += 4) {
      /* Rec. 601 luma, integer-scaled. */
      g[i] = (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8;
    }
    return g;
  }

  /* Sample the source photo on a regular page-mm lattice.
   * H maps page mm -> source pixels. Steps along a row are linear in the
   * homography's numerators and denominator, so we advance incrementally
   * instead of re-evaluating the projection per pixel. */
  function warpGray(gray, srcW, srcH, H, outW, outH, mmPerPxX, mmPerPxY) {
    var out = new Uint8ClampedArray(outW * outH);
    var maxX = srcW - 1, maxY = srcH - 1;
    var dNumU = H[0] * mmPerPxX, dNumV = H[3] * mmPerPxX, dDen = H[6] * mmPerPxX;

    for (var j = 0; j < outH; j++) {
      var Y = (j + 0.5) * mmPerPxY, X0 = 0.5 * mmPerPxX;
      var numU = H[0] * X0 + H[1] * Y + H[2];
      var numV = H[3] * X0 + H[4] * Y + H[5];
      var den = H[6] * X0 + H[7] * Y + 1;
      var row = j * outW;

      for (var i = 0; i < outW; i++, numU += dNumU, numV += dNumV, den += dDen) {
        var u = numU / den, v = numV / den;
        if (u < 0 || v < 0 || u > maxX || v > maxY) { out[row + i] = 255; continue; }
        var x0 = u | 0, y0 = v | 0;
        var x1 = x0 < maxX ? x0 + 1 : x0, y1 = y0 < maxY ? y0 + 1 : y0;
        var fx = u - x0, fy = v - y0;
        var a = gray[y0 * srcW + x0], b = gray[y0 * srcW + x1];
        var c = gray[y1 * srcW + x0], e = gray[y1 * srcW + x1];
        var top = a + (b - a) * fx, bot = c + (e - c) * fx;
        out[row + i] = top + (bot - top) * fy;
      }
    }
    return out;
  }

  /* Sauvola local thresholding. Unlike mean-minus-constant it keys off local
   * standard deviation, so blank paper under uneven lighting stays blank
   * instead of breaking up into speckle. */
  function sauvola(gray, w, h, radius, k) {
    var n = w * h;
    var sum = new Float64Array((w + 1) * (h + 1));
    var sqs = new Float64Array((w + 1) * (h + 1));
    var stride = w + 1, x, y;

    for (y = 0; y < h; y++) {
      var rs = 0, rq = 0, gi = y * w, si = (y + 1) * stride;
      for (x = 0; x < w; x++) {
        var v = gray[gi + x];
        rs += v; rq += v * v;
        sum[si + x + 1] = sum[si - stride + x + 1] + rs;
        sqs[si + x + 1] = sqs[si - stride + x + 1] + rq;
      }
    }

    var mask = new Uint8Array(n), R = 128;
    for (y = 0; y < h; y++) {
      var y0 = y - radius < 0 ? 0 : y - radius;
      var y1 = y + radius >= h ? h - 1 : y + radius;
      for (x = 0; x < w; x++) {
        var x0 = x - radius < 0 ? 0 : x - radius;
        var x1 = x + radius >= w ? w - 1 : x + radius;
        var a = y0 * stride + x0, b = y0 * stride + x1 + 1;
        var c = (y1 + 1) * stride + x0, d = (y1 + 1) * stride + x1 + 1;
        var area = (y1 - y0 + 1) * (x1 - x0 + 1);
        var mean = (sum[d] - sum[b] - sum[c] + sum[a]) / area;
        var varr = (sqs[d] - sqs[b] - sqs[c] + sqs[a]) / area - mean * mean;
        var sd = varr > 0 ? Math.sqrt(varr) : 0;
        var t = mean * (1 + k * (sd / R - 1));
        mask[y * w + x] = gray[y * w + x] < t ? 1 : 0;
      }
    }
    return mask;
  }

  /* Paper level at every pixel — a flat-field estimate.
   *
   * A photograph of a sheet has a lighting gradient across it, so "white" is
   * a different number in one corner than another. Sauvola solves that for a
   * yes/no ink decision; keeping grey needs the same thing as an actual
   * value, so that a pencil line reads as the same grey wherever it sits.
   *
   * Per block, take a high quantile rather than the maximum — the maximum is
   * whatever pixel the sensor noise made brightest. Then dilate across blocks,
   * so a block buried under a thick stroke borrows paper from its neighbours,
   * smooth, and interpolate back up. */
  function background(gray, w, h, block, quantile) {
    var gw = Math.max(1, Math.ceil(w / block)), gh = Math.max(1, Math.ceil(h / block));
    var cell = new Float32Array(gw * gh), hist = new Uint32Array(256);
    var bx, by, x, y, i;

    for (by = 0; by < gh; by++) {
      for (bx = 0; bx < gw; bx++) {
        hist.fill(0);
        var x0 = bx * block, x1 = Math.min(w, x0 + block);
        var y0 = by * block, y1 = Math.min(h, y0 + block), n = 0;
        for (y = y0; y < y1; y++) {
          var row = y * w;
          for (x = x0; x < x1; x++) { hist[gray[row + x]]++; n++; }
        }
        var want = Math.max(1, Math.round(n * quantile)), acc = 0, v = 255;
        for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= want) { v = i; break; } }
        cell[by * gw + bx] = v;
      }
    }

    var dil = new Float32Array(gw * gh);
    for (by = 0; by < gh; by++) {
      for (bx = 0; bx < gw; bx++) {
        var m = 0;
        for (y = by - 1; y <= by + 1; y++) {
          for (x = bx - 1; x <= bx + 1; x++) {
            if (y < 0 || x < 0 || y >= gh || x >= gw) continue;
            if (cell[y * gw + x] > m) m = cell[y * gw + x];
          }
        }
        dil[by * gw + bx] = m;
      }
    }

    var sm = new Float32Array(gw * gh);
    for (by = 0; by < gh; by++) {
      for (bx = 0; bx < gw; bx++) {
        var sum = 0, count = 0;
        for (y = by - 1; y <= by + 1; y++) {
          for (x = bx - 1; x <= bx + 1; x++) {
            if (y < 0 || x < 0 || y >= gh || x >= gw) continue;
            sum += dil[y * gw + x]; count++;
          }
        }
        sm[by * gw + bx] = sum / count;
      }
    }

    /* Bilinear back to full resolution; cell values sit at block centres. */
    var out = new Float32Array(w * h);
    for (y = 0; y < h; y++) {
      var fy = y / block - 0.5;
      var jy = Math.floor(fy), ty = fy - jy;
      var j0 = jy < 0 ? 0 : jy >= gh - 1 ? gh - 1 : jy;
      var j1 = j0 + 1 >= gh ? j0 : j0 + 1;
      if (jy < 0 || jy >= gh - 1) ty = 0;
      for (x = 0; x < w; x++) {
        var fx = x / block - 0.5;
        var jx = Math.floor(fx), tx = fx - jx;
        var i0 = jx < 0 ? 0 : jx >= gw - 1 ? gw - 1 : jx;
        var i1 = i0 + 1 >= gw ? i0 : i0 + 1;
        if (jx < 0 || jx >= gw - 1) tx = 0;
        var top = sm[j0 * gw + i0] + (sm[j0 * gw + i1] - sm[j0 * gw + i0]) * tx;
        var bot = sm[j1 * gw + i0] + (sm[j1 * gw + i1] - sm[j1 * gw + i0]) * tx;
        out[y * w + x] = top + (bot - top) * ty;
      }
    }
    return out;
  }

  /* Flatten to paper-relative tone and stretch what is left.
   *
   *   at or above `white` x paper   -> 255, pure white
   *   at or below `black` x paper   -> 0, solid black
   *   between                       -> the grey it earned
   *
   * The white clip is what stops paper texture and the lighting gradient from
   * turning the whole page into a dirty wash; below it nothing is thresholded
   * away, so a pencil line stays a pencil line. Printed rules sit below the
   * default white point so they survive a scan unless pickup is turned down. */
  function tone(gray, bg, white, black) {
    var out = new Uint8ClampedArray(gray.length);
    var span = white - black;
    for (var i = 0; i < gray.length; i++) {
      var b = bg[i] < 24 ? 24 : bg[i];
      var t = gray[i] / b;
      out[i] = t >= white ? 255 : t <= black ? 0 : ((t - black) / span) * 255;
    }
    return out;
  }

  /* Drop ink blobs too small to be a deliberate mark. Local thresholding
   * always leaves a scatter of one- and two-pixel specks in paper texture;
   * at 200dpi the cut-off here is a dot about a third of a millimetre across,
   * well under the smallest pen mark and well over the noise. */
  function despeckle(mask, w, h, minArea) {
    if (minArea < 2) return mask;
    var seen = new Uint8Array(w * h);
    var stack = [];
    var blob = new Int32Array(minArea + 1);

    for (var start = 0; start < mask.length; start++) {
      if (!mask[start] || seen[start]) continue;
      var count = 0, overflowed = false;
      stack.length = 0;
      stack.push(start);
      seen[start] = 1;

      while (stack.length) {
        var i = stack.pop();
        if (count <= minArea) blob[count] = i; else overflowed = true;
        count++;
        var x = i % w, y = (i / w) | 0;
        if (x > 0 && mask[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
        if (x < w - 1 && mask[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
        if (y > 0 && mask[i - w] && !seen[i - w]) { seen[i - w] = 1; stack.push(i - w); }
        if (y < h - 1 && mask[i + w] && !seen[i + w]) { seen[i + w] = 1; stack.push(i + w); }
      }

      if (!overflowed && count < minArea) {
        for (var k = 0; k < count; k++) mask[blob[k]] = 0;
      }
    }
    return mask;
  }

  PS.geom = {
    homography: homography, affine: affine, apply: apply,
    toGray: toGray, warpGray: warpGray, sauvola: sauvola,
    background: background, tone: tone,
    despeckle: despeckle, solveLinear: solveLinear
  };
})(window.PS);
