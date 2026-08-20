/* PageScan — corner markers.
 * Four QR symbols, one per corner, each naming the paper size, orientation
 * and which corner it is. Drawn as merged vector runs rather than a raster
 * so they stay razor-sharp at any print resolution. */
window.PS = window.PS || {};
(function (PS) {
  'use strict';

  var cache = Object.create(null);

  /* Version 2 / ECC level H holds 20 alphanumeric characters; our payload is
   * 11, so the symbol is always 25x25 and the geometry is fixed. */
  function matrix(text) {
    if (cache[text]) return cache[text];
    var q = qrcode(2, 'H');
    q.addData(text, 'Alphanumeric');
    q.make();
    var size = q.getModuleCount();
    var cells = new Uint8Array(size * size);
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) if (q.isDark(r, c)) cells[r * size + c] = 1;
    }
    var m = { size: size, cells: cells };
    cache[text] = m;
    return m;
  }

  /* Collapse each row into runs so one marker costs ~90 rects, not 300. */
  function runs(m) {
    var out = [];
    for (var r = 0; r < m.size; r++) {
      var c = 0;
      while (c < m.size) {
        if (!m.cells[r * m.size + c]) { c++; continue; }
        var start = c;
        while (c < m.size && m.cells[r * m.size + c]) c++;
        out.push({ row: r, col: start, len: c - start });
      }
    }
    return out;
  }

  /* Draw ops for all four markers of a sheet, in mm. */
  function ops(paperCode, orientation) {
    var origins = PS.markOrigins(paperCode, orientation);
    var out = [];
    PS.CORNERS.forEach(function (corner) {
      var m = matrix(PS.encodePayload(paperCode, orientation, corner));
      var unit = PS.MARK.size / m.size;
      var o = origins[corner];
      runs(m).forEach(function (run) {
        out.push({
          k: 'rect',
          x: o.x + run.col * unit,
          y: o.y + run.row * unit,
          w: run.len * unit,
          h: unit,
          fill: '#111827'
        });
      });
    });
    return out;
  }

  PS.marker = { matrix: matrix, runs: runs, ops: ops };
})(window.PS);
