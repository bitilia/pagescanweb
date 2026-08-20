/* PageScan — one draw-op list, two output targets.
 * The on-screen SVG preview and the downloadable PDF are generated from the
 * exact same ops, which is what guarantees the preview is truthful. */
window.PS = window.PS || {};
(function (PS) {
  'use strict';

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function toSVG(sheet, ops, opts) {
    opts = opts || {};
    var out = [];
    out.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
      sheet.w + ' ' + sheet.h + '" width="100%" height="100%" ' +
      'preserveAspectRatio="xMidYMid meet" role="img" aria-label="' +
      esc(opts.label || 'Page preview') + '">');
    out.push('<rect x="0" y="0" width="' + sheet.w + '" height="' + sheet.h + '" fill="#FFFFFF"/>');
    for (var i = 0; i < ops.length; i++) {
      var o = ops[i];
      if (o.k === 'rect') {
        out.push('<rect x="' + o.x + '" y="' + o.y + '" width="' + o.w +
          '" height="' + o.h + '" fill="' + o.fill + '"/>');
      } else if (o.k === 'circle') {
        out.push('<circle cx="' + o.cx + '" cy="' + o.cy + '" r="' + o.r + '" fill="' + o.fill + '"/>');
      } else if (o.k === 'text') {
        out.push('<text x="' + o.x + '" y="' + o.y + '" font-size="' + o.size +
          '" fill="' + o.fill + '" font-family="Helvetica, Arial, sans-serif" ' +
          'text-anchor="' + (o.anchor === 'middle' ? 'middle' : o.anchor === 'end' ? 'end' : 'start') +
          '" letter-spacing="0.12">' + esc(o.text) + '</text>');
      }
    }
    out.push('</svg>');
    return out.join('');
  }

  /* Batch consecutive same-colour shapes into a single fill, preserving
   * paint order so major rules still land on top of minor ones. */
  function toPDF(ops) {
    var Ops = PS.pdf.Ops;
    var out = [], pending = '', pendingFill = null;

    function flush() {
      if (pending) { out.push(Ops.fill(pendingFill) + pending + 'f\n'); pending = ''; }
    }

    for (var i = 0; i < ops.length; i++) {
      var o = ops[i];
      if (o.k === 'text') {
        flush();
        out.push(Ops.fill(o.fill) + Ops.text(o.x, o.y, o.size, o.text, o.anchor));
        pendingFill = null;
        continue;
      }
      if (o.fill !== pendingFill) { flush(); pendingFill = o.fill; }
      pending += o.k === 'circle'
        ? Ops.circle(o.cx, o.cy, o.r)
        : Ops.rect(o.x, o.y, o.w, o.h);
    }
    flush();
    return out.join('');
  }

  PS.render = { toSVG: toSVG, toPDF: toPDF };
})(window.PS);
