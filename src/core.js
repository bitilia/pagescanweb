/* PageScan — shared vocabulary.
 * Everything downstream (generator, PDF writer, scanner) reads its geometry
 * from here, so the printed sheet and the scanner can never drift apart. */
window.PS = window.PS || {};
(function (PS) {
  'use strict';

  var MM_PER_IN = 25.4;
  var PT_PER_MM = 72 / MM_PER_IN;

  /* Paper stocks. */
  var PAPER = {
    A3: { code: 'A3', label: 'A3', w: 297, h: 420 },
    A4: { code: 'A4', label: 'A4', w: 210, h: 297 },
    A5: { code: 'A5', label: 'A5', w: 148, h: 210 },
    LT: { code: 'LT', label: 'Letter', w: 215.9, h: 279.4 },
    LG: { code: 'LG', label: 'Legal', w: 215.9, h: 355.6 }
  };
  var PAPER_ORDER = ['A4', 'A5', 'A3', 'LT', 'LG'];

  /* Corner marker geometry, in mm.
   *
   * Each corner carries an L-shaped registration mark hugging the two page
   * edges — thick arms in the margin, open toward the writing area — so the
   * keep-out is two thin strips rather than a filled square. The bottom-right
   * corner is a T: the same L plus a short inward stem. That odd one out is
   * what tells the scanner which way up the sheet is.
   *
   * The fiducial is the INNER CROOK of each mark (where the two inner edges
   * meet). It is recovered by averaging every scan that hits the junction,
   * which puts it well inside a pixel, and the four crooks form a rectangle
   * inset by MARK.inset on every side whatever the paper. */
  var MARK = {
    width: 2.2,   // arm stroke
    length: 14,   // arm length along each page edge
    stem: 8,      // inward stem on the T at BR only
    edge: 5,      // page edge -> outer face of an arm
    quiet: 2.2    // silent margin kept clear of rules around each arm
  };
  /* Rounded so the millimetres that reach the PDF and the SVG are the exact
   * decimals quoted here, not 14.000000000000002. */
  function mm(v) { return Math.round(v * 1e6) / 1e6; }
  MARK.inset = mm(MARK.edge + MARK.width);   // 7.2mm, edge -> crook

  var CORNERS = ['TL', 'TR', 'BR', 'BL'];
  var TEE_CORNER = 'BR';   // the one that differs, so "up" is never in doubt

  function markKind(corner) {
    return corner === TEE_CORNER ? 'tee' : 'ell';
  }

  /* Outer dimensions of a sheet once orientation is applied. */
  function sheetSize(paperCode, orientation) {
    var p = PAPER[paperCode];
    if (!p) throw new Error('unknown paper ' + paperCode);
    return orientation === 'L'
      ? { w: p.h, h: p.w }
      : { w: p.w, h: p.h };
  }

  /* The four fiducials — mark crooks — in page space (mm, origin top-left,
   * y down). Order matches CORNERS. */
  function fiducials(paperCode, orientation) {
    var s = sheetSize(paperCode, orientation), i = MARK.inset;
    return {
      TL: { x: i, y: i },
      TR: { x: mm(s.w - i), y: i },
      BR: { x: mm(s.w - i), y: mm(s.h - i) },
      BL: { x: i, y: mm(s.h - i) }
    };
  }

  /* Axis-aligned rectangles covering each arm (and the T stem) plus quiet.
   * Template rules are clipped out of these so nothing intrudes on a mark;
   * returning one rect per arm — not one square per corner — leaves the open
   * diagonal free for rulings and handwriting. */
  function keepouts(paperCode, orientation) {
    var s = sheetSize(paperCode, orientation);
    var e = MARK.edge, w = MARK.width, L = MARK.length, q = MARK.quiet;
    var stem = MARK.stem;
    var out = [];

    function add(x, y, rw, rh) {
      out.push({
        x: mm(Math.max(0, x - q)),
        y: mm(Math.max(0, y - q)),
        w: mm(Math.min(s.w, x + rw + q) - Math.max(0, x - q)),
        h: mm(Math.min(s.h, y + rh + q) - Math.max(0, y - q))
      });
    }

    /* TL L */
    add(e, e, L, w);
    add(e, e, w, L);
    /* TR L */
    add(s.w - e - L, e, L, w);
    add(s.w - e - w, e, w, L);
    /* BR T: L plus a stem block in the open diagonal */
    add(s.w - e - L, s.h - e - w, L, w);
    add(s.w - e - w, s.h - e - L, w, L);
    add(s.w - e - w - stem, s.h - e - w - stem, stem, stem);
    /* BL L */
    add(e, s.h - e - w, L, w);
    add(e, s.h - e - L, w, L);

    return out;
  }

  /* Drawing geometry for each corner: crook plus arm rectangles in mm. */
  function markParts(paperCode, orientation) {
    var s = sheetSize(paperCode, orientation);
    var e = MARK.edge, w = MARK.width, L = MARK.length, stem = MARK.stem;
    var fid = fiducials(paperCode, orientation);
    return {
      TL: {
        kind: 'ell', crook: fid.TL,
        arms: [
          { x: e, y: e, w: L, h: w },
          { x: e, y: e, w: w, h: L }
        ]
      },
      TR: {
        kind: 'ell', crook: fid.TR,
        arms: [
          { x: mm(s.w - e - L), y: e, w: L, h: w },
          { x: mm(s.w - e - w), y: e, w: w, h: L }
        ]
      },
      BR: {
        kind: 'tee', crook: fid.BR,
        arms: [
          { x: mm(s.w - e - L), y: mm(s.h - e - w), w: L, h: w },
          { x: mm(s.w - e - w), y: mm(s.h - e - L), w: w, h: L },
          /* Stem block in the open diagonal, attached to the crook. */
          { x: mm(s.w - e - w - stem), y: mm(s.h - e - w - stem), w: stem, h: stem }
        ]
      },
      BL: {
        kind: 'ell', crook: fid.BL,
        arms: [
          { x: e, y: mm(s.h - e - w), w: L, h: w },
          { x: e, y: mm(s.h - e - L), w: w, h: L }
        ]
      }
    };
  }

  PS.MM_PER_IN = MM_PER_IN;
  PS.PT_PER_MM = PT_PER_MM;
  PS.PAPER = PAPER;
  PS.PAPER_ORDER = PAPER_ORDER;
  PS.MARK = MARK;
  PS.CORNERS = CORNERS;
  PS.TEE_CORNER = TEE_CORNER;
  PS.ALIGN_CORNER = TEE_CORNER; /* old name kept for any stray callers */
  PS.mm = mm;
  PS.markKind = markKind;
  PS.sheetSize = sheetSize;
  PS.fiducials = fiducials;
  PS.keepouts = keepouts;
  PS.markParts = markParts;
})(window.PS);
