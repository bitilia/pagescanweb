/* PageScan — corner markers.
 * L-shaped registration marks in three corners and a five-module alignment
 * square at the fourth. The L arms hug the page edges so the open diagonal
 * stays free for writing; the alignment square is the orientation cue. */
window.PS = window.PS || {};
(function (PS) {
  'use strict';

  var ALIGN = [
    '11111',
    '10001',
    '10101',
    '10001',
    '11111'
  ];

  function alignRuns() {
    var out = [], r, c;
    for (r = 0; r < ALIGN.length; r++) {
      c = 0;
      while (c < ALIGN[r].length) {
        if (ALIGN[r].charCodeAt(c) !== 49) { c++; continue; }
        var start = c;
        while (c < ALIGN[r].length && ALIGN[r].charCodeAt(c) === 49) c++;
        out.push({ row: r, col: start, len: c - start });
      }
    }
    return out;
  }

  var ALIGN_RUNS = alignRuns();

  /* Draw ops for all four markers of a sheet, in mm. */
  function ops(paperCode, orientation) {
    var parts = PS.markParts(paperCode, orientation);
    var unit = PS.MARK.width;
    var out = [];
    PS.CORNERS.forEach(function (corner) {
      var p = parts[corner];
      if (p.align) {
        ALIGN_RUNS.forEach(function (run) {
          out.push({
            k: 'rect',
            x: PS.mm(p.align.x + run.col * unit),
            y: PS.mm(p.align.y + run.row * unit),
            w: PS.mm(run.len * unit),
            h: unit,
            fill: '#111827'
          });
        });
      } else {
        p.arms.forEach(function (a) {
          out.push({ k: 'rect', x: a.x, y: a.y, w: a.w, h: a.h, fill: '#111827' });
        });
      }
    });
    return out;
  }

  PS.marker = { ops: ops, ALIGN: ALIGN };
})(window.PS);
