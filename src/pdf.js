/* PageScan — a small PDF 1.4 writer.
 * We emit PDFs rather than relying on browser print because print scaling
 * ("fit to page") would corrupt the millimetre geometry the scanner keys on.
 * Content is authored in mm with a top-left origin; each page's CTM does the
 * flip into PDF's bottom-left point space. */
window.PS = window.PS || {};
(function (PS) {
  'use strict';

  var enc = new TextEncoder();
  var PT = 72 / 25.4;

  function bytes(x) { return typeof x === 'string' ? enc.encode(x) : x; }

  function concat(chunks) {
    var n = 0, i;
    for (i = 0; i < chunks.length; i++) n += chunks[i].length;
    var out = new Uint8Array(n), o = 0;
    for (i = 0; i < chunks.length; i++) { out.set(chunks[i], o); o += chunks[i].length; }
    return out;
  }

  /* Trim float noise: PDF files get a lot smaller and stay readable. */
  function n(v) {
    var s = (Math.round(v * 1000) / 1000).toString();
    return s === '-0' ? '0' : s;
  }

  async function deflate(u8) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      var cs = new CompressionStream('deflate');
      var stream = new Blob([u8]).stream().pipeThrough(cs);
      var buf = await new Response(stream).arrayBuffer();
      return new Uint8Array(buf);
    } catch (e) { return null; }
  }

  function Doc() {
    this.objs = [null];   // 1-indexed, matching PDF object numbers
    this.pages = [];
  }

  Doc.prototype.alloc = function () { this.objs.push(null); return this.objs.length - 1; };
  Doc.prototype.set = function (id, data) { this.objs[id] = data; return id; };
  Doc.prototype.add = function (data) { return this.set(this.alloc(), data); };

  Doc.prototype.stream = function (dict, data) {
    var d = bytes(data);
    return concat([
      bytes('<< ' + dict + ' /Length ' + d.length + ' >>\nstream\n'),
      d,
      bytes('\nendstream')
    ]);
  };

  /* content: string of operators authored in mm, y down, origin top-left.
   * xobjects: { Im0: objectId, ... } */
  Doc.prototype.addPage = function (widthMm, heightMm, content, xobjects, useFont) {
    var hPt = heightMm * PT;
    var prelude = n(PT) + ' 0 0 ' + n(-PT) + ' 0 ' + n(hPt) + ' cm\n';
    var contentId = this.add(this.stream('', prelude + content));
    var pageId = this.alloc();
    this.pages.push({
      id: pageId,
      contentId: contentId,
      w: widthMm * PT,
      h: hPt,
      xobjects: xobjects || null,
      useFont: !!useFont
    });
    return pageId;
  };

  Doc.prototype.build = async function () {
    var self = this;
    var catalogId = this.alloc();
    var pagesId = this.alloc();
    var fontId = null;

    this.pages.forEach(function (p) {
      if (p.useFont && fontId === null) fontId = self.alloc();
    });
    if (fontId !== null) {
      this.set(fontId, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    }

    this.pages.forEach(function (p) {
      var res = ['/ProcSet [/PDF /Text /ImageB /ImageC]'];
      if (p.useFont && fontId !== null) res.push('/Font << /F1 ' + fontId + ' 0 R >>');
      if (p.xobjects) {
        var xo = Object.keys(p.xobjects).map(function (k) {
          return '/' + k + ' ' + p.xobjects[k] + ' 0 R';
        }).join(' ');
        if (xo) res.push('/XObject << ' + xo + ' >>');
      }
      self.set(p.id,
        '<< /Type /Page /Parent ' + pagesId + ' 0 R' +
        ' /MediaBox [0 0 ' + n(p.w) + ' ' + n(p.h) + ']' +
        ' /Resources << ' + res.join(' ') + ' >>' +
        ' /Contents ' + p.contentId + ' 0 R >>');
    });

    this.set(pagesId,
      '<< /Type /Pages /Count ' + this.pages.length +
      ' /Kids [' + this.pages.map(function (p) { return p.id + ' 0 R'; }).join(' ') + '] >>');
    this.set(catalogId, '<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>');

    var chunks = [], offset = 0, offsets = [0];
    function push(chunk) { var b = bytes(chunk); chunks.push(b); offset += b.length; }

    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    for (var i = 1; i < this.objs.length; i++) {
      offsets[i] = offset;
      push(i + ' 0 obj\n');
      push(this.objs[i] === null ? '<< >>' : this.objs[i]);
      push('\nendobj\n');
    }

    var xrefAt = offset;
    var xref = 'xref\n0 ' + this.objs.length + '\n0000000000 65535 f \n';
    for (i = 1; i < this.objs.length; i++) {
      xref += ('0000000000' + offsets[i]).slice(-10) + ' 00000 n \n';
    }
    push(xref);
    push('trailer\n<< /Size ' + this.objs.length + ' /Root ' + catalogId + ' 0 R >>\n' +
         'startxref\n' + xrefAt + '\n%%EOF\n');

    return new Blob([concat(chunks)], { type: 'application/pdf' });
  };

  /* ---- content helpers (mm, y down) ----------------------------------- */

  function hexColor(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16) / 255,
            parseInt(h.slice(2, 4), 16) / 255,
            parseInt(h.slice(4, 6), 16) / 255];
  }


  /* Helvetica advance widths (1000 units/em) for WinAnsi 32..126, plus the
   * few high codes our captions use. Lets us centre text without a font lib. */
  var HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,
    556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,
    1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,
    667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,
    333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,
    556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
  /* Unicode -> WinAnsi for the handful of glyphs we emit. */
  var WINANSI = { 0xB7: 0xB7, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
                  0x00D7: 0xD7, 0x00B0: 0xB0, 0x2019: 0x92 };
  var HIGH_W = { 0xB7: 278, 0x95: 350, 0x96: 556, 0x97: 1000, 0xD7: 584, 0xB0: 400, 0x92: 222 };

  function winAnsiCode(cp) {
    if (cp >= 32 && cp <= 126) return cp;
    return WINANSI[cp] || 0x3F; // '?'
  }

  function textWidth(str, sizeMm) {
    var s = String(str), total = 0;
    for (var i = 0; i < s.length; i++) {
      var c = winAnsiCode(s.codePointAt(i));
      total += (c >= 32 && c <= 126) ? HELV[c - 32] : (HIGH_W[c] || 556);
    }
    return total / 1000 * sizeMm;
  }

  function escapeText(str) {
    var s = String(str), out = '';
    for (var i = 0; i < s.length; i++) {
      var c = winAnsiCode(s.codePointAt(i));
      if (c === 40 || c === 41 || c === 92) out += '\\' + s[i];
      else if (c >= 32 && c <= 126) out += String.fromCharCode(c);
      else out += '\\' + ('00' + c.toString(8)).slice(-3);
    }
    return out;
  }

  var Ops = {
    fill: function (hex) { var c = hexColor(hex); return n(c[0]) + ' ' + n(c[1]) + ' ' + n(c[2]) + ' rg\n'; },
    rect: function (x, y, w, h) { return n(x) + ' ' + n(y) + ' ' + n(w) + ' ' + n(h) + ' re\n'; },
    /* Circle from four Béziers — used for dot grids. */
    circle: function (cx, cy, r) {
      var k = 0.5523 * r;
      return n(cx + r) + ' ' + n(cy) + ' m\n' +
        n(cx + r) + ' ' + n(cy + k) + ' ' + n(cx + k) + ' ' + n(cy + r) + ' ' + n(cx) + ' ' + n(cy + r) + ' c\n' +
        n(cx - k) + ' ' + n(cy + r) + ' ' + n(cx - r) + ' ' + n(cy + k) + ' ' + n(cx - r) + ' ' + n(cy) + ' c\n' +
        n(cx - r) + ' ' + n(cy - k) + ' ' + n(cx - k) + ' ' + n(cy - r) + ' ' + n(cx) + ' ' + n(cy - r) + ' c\n' +
        n(cx + k) + ' ' + n(cy - r) + ' ' + n(cx + r) + ' ' + n(cy - k) + ' ' + n(cx + r) + ' ' + n(cy) + ' c\n';
    },
    /* Text matrix re-flips y so glyphs sit upright under the page CTM. */
    text: function (x, y, sizeMm, str, anchor) {
      var w = textWidth(str, sizeMm);
      var tx = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
      return 'BT /F1 ' + n(sizeMm) + ' Tf 1 0 0 -1 ' + n(tx) + ' ' + n(y) +
        ' Tm (' + escapeText(str) + ') Tj ET\n';
    },
    /* Image XObjects are drawn bottom-up, so flip height to land top-left. */
    image: function (name, x, y, w, h) {
      return 'q ' + n(w) + ' 0 0 ' + n(-h) + ' ' + n(x) + ' ' + n(y + h) + ' cm /' + name + ' Do Q\n';
    }
  };

  /* An 8-bit greyscale image. Pages are overwhelmingly pure white, which
   * Flate reduces to almost nothing, so keeping tone costs far less than the
   * eight-fold rise in raw bytes suggests. */
  async function addGrayImage(doc, gray, w, h) {
    var raw = gray instanceof Uint8Array ? gray : new Uint8Array(gray.buffer, gray.byteOffset, gray.length);
    var packed = await deflate(raw);
    var dict = '/Type /XObject /Subtype /Image /Width ' + w + ' /Height ' + h +
      ' /ColorSpace /DeviceGray /BitsPerComponent 8';
    if (packed && packed.length < raw.length) {
      return doc.add(doc.stream(dict + ' /Filter /FlateDecode', packed));
    }
    return doc.add(doc.stream(dict, raw));
  }

  PS.pdf = {
    Doc: Doc,
    Ops: Ops,
    num: n,
    hexColor: hexColor,
    deflate: deflate,
    textWidth: textWidth,
    addGrayImage: addGrayImage
  };
})(window.PS);
