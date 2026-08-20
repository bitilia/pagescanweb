/* PageScan — sheet generation. Rulings + markers -> preview or PDF. */
window.PS = window.PS || {};
(function (PS) {
  'use strict';

  /* Full op list for one sheet: rulings first, markers last so nothing can
   * paint over a symbol. */
  function compose(spec) {
    var built = PS.templates.build(spec);
    return {
      sheet: built.sheet,
      ops: built.ops.concat(PS.marker.ops(spec.paper, spec.orientation))
    };
  }

  function preview(spec) {
    var c = compose(spec);
    return PS.render.toSVG(c.sheet, c.ops, { label: PS.templates.caption(spec) });
  }

  async function toPDF(spec, pageCount) {
    var c = compose(spec);
    var content = PS.render.toPDF(c.ops);
    var doc = new PS.pdf.Doc();
    var n = Math.max(1, Math.min(200, pageCount | 0 || 1));
    for (var i = 0; i < n; i++) {
      doc.addPage(c.sheet.w, c.sheet.h, content, null, true);
    }
    return doc.build();
  }

  function filename(spec, pageCount) {
    return ['pagescan', PS.PAPER[spec.paper].label.toLowerCase().replace(/\s+/g, ''),
            spec.orientation === 'L' ? 'landscape' : 'portrait',
            spec.template, pageCount + 'p'].join('-') + '.pdf';
  }

  PS.generator = { compose: compose, preview: preview, toPDF: toPDF, filename: filename };
})(window.PS);
