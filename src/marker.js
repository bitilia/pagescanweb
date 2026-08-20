/* PageScan — corner markers.
 * L-shaped registration marks in three corners and a T at the fourth, drawn
 * as a few solid rectangles hugging the page edges. They carry no data: the
 * stroke is 2.2mm so the mark survives a phone photograph, and the open
 * diagonal of each L leaves the writing area alone. */
window.PS = window.PS || {};
(function (PS) {
  'use strict';

  /* Draw ops for all four markers of a sheet, in mm. */
  function ops(paperCode, orientation) {
    var parts = PS.markParts(paperCode, orientation);
    var out = [];
    PS.CORNERS.forEach(function (corner) {
      parts[corner].arms.forEach(function (a) {
        out.push({
          k: 'rect',
          x: a.x, y: a.y, w: a.w, h: a.h,
          fill: '#111827'
        });
      });
    });
    return out;
  }

  PS.marker = { ops: ops };
})(window.PS);
