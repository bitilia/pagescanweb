/* PageScan — corner markers.
 * The registration patterns a QR code carries in its own corners, printed on
 * their own: a seven-module finder square at three corners and the smaller
 * five-module alignment square at the fourth. They carry no data, which is the
 * point — a module is 2.2mm rather than 0.6mm, so the marker survives a phone
 * photograph with room to spare. Drawn as merged vector runs rather than a
 * raster so they stay razor-sharp at any print resolution. */
window.PS = window.PS || {};
(function (PS) {
  'use strict';

  /* Ring, gap, core — the 1:1:3:1:1 cross-section is what the scanner hunts
   * for along every row and column of the photograph. */
  var PATTERN = {
    finder: [
      '1111111',
      '1000001',
      '1011101',
      '1011101',
      '1011101',
      '1000001',
      '1111111'
    ],
    align: [
      '11111',
      '10001',
      '10101',
      '10001',
      '11111'
    ]
  };

  var cache = Object.create(null);

  function matrix(kind) {
    if (cache[kind]) return cache[kind];
    var rows = PATTERN[kind];
    if (!rows) throw new Error('unknown marker ' + kind);
    var size = rows.length;
    var cells = new Uint8Array(size * size);
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) cells[r * size + c] = rows[r].charCodeAt(c) === 49 ? 1 : 0;
    }
    var m = { size: size, cells: cells };
    cache[kind] = m;
    return m;
  }

  /* Collapse each row into runs, so a finder costs 15 rects rather than 33. */
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
    var unit = PS.MARK.module;
    var out = [];
    PS.CORNERS.forEach(function (corner) {
      var m = matrix(PS.markKind(corner));
      var o = origins[corner];
      runs(m).forEach(function (run) {
        out.push({
          k: 'rect',
          x: PS.mm(o.x + run.col * unit),
          y: PS.mm(o.y + run.row * unit),
          w: PS.mm(run.len * unit),
          h: unit,
          fill: '#111827'
        });
      });
    });
    return out;
  }

  PS.marker = { PATTERN: PATTERN, matrix: matrix, runs: runs, ops: ops };
})(window.PS);
