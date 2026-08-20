/* PageScan — the captured-page store and the scanned-document PDF.
 * Each page keeps its own paper size, so a document can mix A4 and A5 and
 * every sheet still comes out at its true dimensions. */
window.PS = window.PS || {};
(function (PS) {
  'use strict';

  var nextId = 1;

  function makePage(rect, meta) {
    return {
      id: 'p' + (nextId++),
      mask: rect.mask,
      width: rect.width,
      height: rect.height,
      sheet: rect.sheet,
      dpi: rect.dpi,
      nativeDpi: rect.nativeDpi,
      paper: rect.paper,
      orientation: rect.orientation,
      exact: rect.exact,
      source: meta.source || 'capture',
      name: meta.name || ''
    };
  }

  /* Area-average the ink mask down to a small greyscale thumbnail; sampling
   * instead would drop thin pen strokes entirely at this size.
   * Cached on the page, since reordering re-renders the whole list. */
  function thumbnail(page, maxDim) {
    if (page.thumb && page.thumbDim === maxDim) return page.thumb;
    var canvas = renderThumbnail(page, maxDim);
    page.thumb = canvas;
    page.thumbDim = maxDim;
    return canvas;
  }

  function renderThumbnail(page, maxDim) {
    var scale = Math.min(maxDim / page.width, maxDim / page.height);
    var w = Math.max(1, Math.round(page.width * scale));
    var h = Math.max(1, Math.round(page.height * scale));
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d');
    var out = ctx.createImageData(w, h);
    var sx = page.width / w, sy = page.height / h;

    for (var y = 0; y < h; y++) {
      var y0 = Math.floor(y * sy), y1 = Math.min(page.height, Math.max(y0 + 1, Math.ceil((y + 1) * sy)));
      for (var x = 0; x < w; x++) {
        var x0 = Math.floor(x * sx), x1 = Math.min(page.width, Math.max(x0 + 1, Math.ceil((x + 1) * sx)));
        var ink = 0, n = 0;
        for (var yy = y0; yy < y1; yy++) {
          var row = yy * page.width;
          for (var xx = x0; xx < x1; xx++) { ink += page.mask[row + xx]; n++; }
        }
        var v = 255 - Math.round((ink / n) * 255);
        var o = (y * w + x) * 4;
        out.data[o] = out.data[o + 1] = out.data[o + 2] = v;
        out.data[o + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
    return canvas;
  }

  async function toPDF(pages) {
    var doc = new PS.pdf.Doc();
    for (var i = 0; i < pages.length; i++) {
      var page = pages[i];
      var id = await PS.pdf.addBilevelImage(doc, page.mask, page.width, page.height);
      doc.addPage(page.sheet.w, page.sheet.h,
        PS.pdf.Ops.image('Im0', 0, 0, page.sheet.w, page.sheet.h),
        { Im0: id }, false);
    }
    return doc.build();
  }

  function filename(pages) {
    var stamp = new Date().toISOString().slice(0, 10);
    return 'pagescan-' + stamp + '-' + pages.length + 'p.pdf';
  }

  PS.pages = { makePage: makePage, thumbnail: thumbnail, toPDF: toPDF, filename: filename };
})(window.PS);
