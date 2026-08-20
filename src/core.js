/* PageScan — shared vocabulary.
 * Everything downstream (generator, PDF writer, scanner) reads its geometry
 * from here, so the printed sheet and the scanner can never drift apart. */
window.PS = window.PS || {};
(function (PS) {
  'use strict';

  var MM_PER_IN = 25.4;
  var PT_PER_MM = 72 / MM_PER_IN;

  /* Paper stocks. Codes are two chars so they fit QR alphanumeric mode. */
  var PAPER = {
    A3: { code: 'A3', label: 'A3', w: 297, h: 420 },
    A4: { code: 'A4', label: 'A4', w: 210, h: 297 },
    A5: { code: 'A5', label: 'A5', w: 148, h: 210 },
    LT: { code: 'LT', label: 'Letter', w: 215.9, h: 279.4 },
    LG: { code: 'LG', label: 'Legal', w: 215.9, h: 355.6 }
  };
  var PAPER_ORDER = ['A4', 'A5', 'A3', 'LT', 'LG'];

  /* Corner marker geometry, in mm. These four numbers are the contract
   * between print and scan: the fiducial is each marker's outward corner,
   * so the reference rectangle is inset by MARK.inset on every side. */
  var MARK = {
    size: 15,        // side length of the QR symbol itself
    inset: 6,        // page edge -> outward corner of the symbol
    modules: 25,     // QR version 2 == 25x25 modules
    quietModules: 4  // required silent margin, kept clear of rules
  };
  MARK.quiet = MARK.quietModules * (MARK.size / MARK.modules); // 2.4mm

  var CORNERS = ['TL', 'TR', 'BR', 'BL'];

  /* ---- payload codec -------------------------------------------------- *
   * "PS1:A4:P:TL" — 11 chars, all inside QR alphanumeric mode, which keeps
   * the symbol at version 2 even at error-correction level H.            */
  var PAYLOAD_RE = /^PS1:([A-Z0-9]{2}):([PL]):(TL|TR|BR|BL)$/;

  function encodePayload(paperCode, orientation, corner) {
    return 'PS1:' + paperCode + ':' + orientation + ':' + corner;
  }

  function decodePayload(text) {
    var m = PAYLOAD_RE.exec(String(text || '').trim());
    if (!m) return null;
    if (!PAPER[m[1]]) return null;
    return { paper: m[1], orientation: m[2], corner: m[3] };
  }

  /* Outer dimensions of a sheet once orientation is applied. */
  function sheetSize(paperCode, orientation) {
    var p = PAPER[paperCode];
    if (!p) throw new Error('unknown paper ' + paperCode);
    return orientation === 'L'
      ? { w: p.h, h: p.w }
      : { w: p.w, h: p.h };
  }

  /* The four fiducials in page space (mm, origin top-left, y down).
   * Order matches CORNERS. */
  function fiducials(paperCode, orientation) {
    var s = sheetSize(paperCode, orientation), i = MARK.inset;
    return {
      TL: { x: i, y: i },
      TR: { x: s.w - i, y: i },
      BR: { x: s.w - i, y: s.h - i },
      BL: { x: i, y: s.h - i }
    };
  }

  /* Bounding box of each marker plus its quiet zone. Template rules are
   * clipped out of these so nothing intrudes on the symbol. */
  function keepouts(paperCode, orientation) {
    var s = sheetSize(paperCode, orientation);
    var i = MARK.inset, z = MARK.size, q = MARK.quiet;
    var a = i - q, b = z + 2 * q;
    return [
      { x: a, y: a, w: b, h: b },
      { x: s.w - a - b, y: a, w: b, h: b },
      { x: s.w - a - b, y: s.h - a - b, w: b, h: b },
      { x: a, y: s.h - a - b, w: b, h: b }
    ];
  }

  /* Top-left origin of each marker symbol. */
  function markOrigins(paperCode, orientation) {
    var s = sheetSize(paperCode, orientation), i = MARK.inset, z = MARK.size;
    return {
      TL: { x: i, y: i },
      TR: { x: s.w - i - z, y: i },
      BR: { x: s.w - i - z, y: s.h - i - z },
      BL: { x: i, y: s.h - i - z }
    };
  }

  PS.MM_PER_IN = MM_PER_IN;
  PS.PT_PER_MM = PT_PER_MM;
  PS.PAPER = PAPER;
  PS.PAPER_ORDER = PAPER_ORDER;
  PS.MARK = MARK;
  PS.CORNERS = CORNERS;
  PS.encodePayload = encodePayload;
  PS.decodePayload = decodePayload;
  PS.sheetSize = sheetSize;
  PS.fiducials = fiducials;
  PS.keepouts = keepouts;
  PS.markOrigins = markOrigins;
})(window.PS);
