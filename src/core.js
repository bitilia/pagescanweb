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
   * The markers are the plain registration patterns every QR code carries in
   * its own corners: a seven-module finder square at three corners and the
   * five-module alignment square at the fourth. Nothing is encoded in them —
   * they are pure position. Modules are 1.5mm (about 1.5× smaller than the
   * earlier 2.2mm eyes) so the keep-out stays out of the writing area once
   * content is inset past the quiet zone.
   *
   * The fiducial is each marker's CENTRE. A centre is recovered by averaging
   * dozens of scan lines, so it is far steadier under blur and perspective
   * than any corner of a symbol, and the four of them form a rectangle inset
   * by MARK.inset on every side whatever the paper.
   *
   * Which corner carries the odd one out is what tells the scanner which way
   * up the sheet is — the same trick a QR code plays with its three eyes. */
  var MARK = {
    module: 1.5,       // one module, printed (~1.5× smaller than 2.2mm)
    finderModules: 7,  // the familiar QR eye: ring, gap, core
    alignModules: 5,   // the smaller alignment square
    edge: 6,           // page edge -> outer edge of a finder square
    quietModules: 2    // silent margin kept clear of rules
  };
  /* Rounded so the millimetres that reach the PDF and the SVG are the exact
   * decimals quoted here, not 10.500000000000002. */
  function mm(v) { return Math.round(v * 1e6) / 1e6; }
  MARK.finder = mm(MARK.finderModules * MARK.module);  // 10.5mm
  MARK.align = mm(MARK.alignModules * MARK.module);    // 7.5mm
  MARK.quiet = mm(MARK.quietModules * MARK.module);    // 3.0mm
  MARK.inset = mm(MARK.edge + MARK.finder / 2);        // 11.25mm, edge -> centre
  /* Content must start beyond the finder + quiet zone so top markers never
   * sit on rulings or handwriting. Same figure on every side. */
  MARK.content = mm(MARK.edge + MARK.finder + MARK.quiet); // 19.5mm

  var CORNERS = ['TL', 'TR', 'BR', 'BL'];
  var ALIGN_CORNER = 'BR';   // the one that differs, so "up" is never in doubt

  function markKind(corner) {
    return corner === ALIGN_CORNER ? 'align' : 'finder';
  }

  /* Side length of the marker at a given corner. */
  function markSpan(corner) {
    return corner === ALIGN_CORNER ? MARK.align : MARK.finder;
  }

  /* Outer dimensions of a sheet once orientation is applied. */
  function sheetSize(paperCode, orientation) {
    var p = PAPER[paperCode];
    if (!p) throw new Error('unknown paper ' + paperCode);
    return orientation === 'L'
      ? { w: p.h, h: p.w }
      : { w: p.w, h: p.h };
  }

  /* The four fiducials — marker centres — in page space (mm, origin
   * top-left, y down). Order matches CORNERS. */
  function fiducials(paperCode, orientation) {
    var s = sheetSize(paperCode, orientation), i = MARK.inset;
    return {
      TL: { x: i, y: i },
      TR: { x: mm(s.w - i), y: i },
      BR: { x: mm(s.w - i), y: mm(s.h - i) },
      BL: { x: i, y: mm(s.h - i) }
    };
  }

  /* Bounding box of each marker plus its quiet zone. Template rules are
   * clipped out of these so nothing intrudes on the pattern. */
  function keepouts(paperCode, orientation) {
    var c = fiducials(paperCode, orientation);
    return CORNERS.map(function (corner) {
      var half = markSpan(corner) / 2 + MARK.quiet;
      return { x: mm(c[corner].x - half), y: mm(c[corner].y - half), w: mm(half * 2), h: mm(half * 2) };
    });
  }

  /* Top-left corner of each marker's own square, for drawing. */
  function markOrigins(paperCode, orientation) {
    var c = fiducials(paperCode, orientation);
    var out = {};
    CORNERS.forEach(function (corner) {
      var half = markSpan(corner) / 2;
      out[corner] = { x: mm(c[corner].x - half), y: mm(c[corner].y - half) };
    });
    return out;
  }

  PS.MM_PER_IN = MM_PER_IN;
  PS.PT_PER_MM = PT_PER_MM;
  PS.PAPER = PAPER;
  PS.PAPER_ORDER = PAPER_ORDER;
  PS.MARK = MARK;
  PS.CORNERS = CORNERS;
  PS.ALIGN_CORNER = ALIGN_CORNER;
  PS.mm = mm;
  PS.markKind = markKind;
  PS.markSpan = markSpan;
  PS.sheetSize = sheetSize;
  PS.fiducials = fiducials;
  PS.keepouts = keepouts;
  PS.markOrigins = markOrigins;
})(window.PS);
