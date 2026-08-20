/* PageScan — page rulings.
 * Each template emits an abstract draw-op list in mm (origin top-left, y
 * down). The same list feeds the SVG preview and the PDF exporter, so what
 * you see is literally what gets printed. Rules are clipped out of the
 * corner keep-out boxes so nothing ever intrudes on a marker's quiet zone. */
window.PS = window.PS || {};
(function (PS) {
  'use strict';

  /* Rule colours sit close to the UI swatch so an inkjet on ordinary paper
   * still lays down enough pigment for a flatbed or phone scan to keep them.
   * They remain lighter than handwriting, so lowering ink pickup can still
   * wash the guides away when you only want what you wrote.
   * `swatch` is the saturated chip shown in the UI; print tones track it. */
  var INKS = {
    slate:   { key: 'slate',   label: 'Slate', swatch: '#9AA3AE', minor: '#B0B7C0', major: '#A3ABB5', accent: '#9AA3AE' },
    blue:    { key: 'blue',    label: 'Blue',  swatch: '#6FA0E8', minor: '#8FB4EC', major: '#7DA8EA', accent: '#6FA0E8' },
    emerald: { key: 'emerald', label: 'Green', swatch: '#5FC49E', minor: '#7FCEB1', major: '#6DC8A7', accent: '#5FC49E' },
    amber:   { key: 'amber',   label: 'Amber', swatch: '#E0A94B', minor: '#E6B86A', major: '#E2AE54', accent: '#E0A94B' }
  };
  var INK_ORDER = ['slate', 'blue', 'emerald', 'amber'];

  var MARGIN = 12;      // content inset, mm
  var CAPTION_PAD = 4;  // baseline offset for the human-readable caption

  /* ---- 1-D subtraction, used to clip rules around the markers ---------- */
  function subtract(spans, a, b) {
    var out = [];
    for (var i = 0; i < spans.length; i++) {
      var s = spans[i];
      if (b <= s[0] || a >= s[1]) { out.push(s); continue; }
      if (a > s[0]) out.push([s[0], a]);
      if (b < s[1]) out.push([b, s[1]]);
    }
    return out;
  }

  function hRule(ops, y, t, x0, x1, fill, kos) {
    var spans = [[x0, x1]];
    for (var i = 0; i < kos.length; i++) {
      var k = kos[i];
      if (k.y < y + t && k.y + k.h > y) spans = subtract(spans, k.x, k.x + k.w);
    }
    for (i = 0; i < spans.length; i++) {
      if (spans[i][1] - spans[i][0] > 0.2) {
        ops.push({ k: 'rect', x: spans[i][0], y: y, w: spans[i][1] - spans[i][0], h: t, fill: fill });
      }
    }
  }

  function vRule(ops, x, t, y0, y1, fill, kos) {
    var spans = [[y0, y1]];
    for (var i = 0; i < kos.length; i++) {
      var k = kos[i];
      if (k.x < x + t && k.x + k.w > x) spans = subtract(spans, k.y, k.y + k.h);
    }
    for (i = 0; i < spans.length; i++) {
      if (spans[i][1] - spans[i][0] > 0.2) {
        ops.push({ k: 'rect', x: x, y: spans[i][0], w: t, h: spans[i][1] - spans[i][0], fill: fill });
      }
    }
  }

  function inKeepout(kos, x, y) {
    for (var i = 0; i < kos.length; i++) {
      var k = kos[i];
      if (x >= k.x && x <= k.x + k.w && y >= k.y && y <= k.y + k.h) return true;
    }
    return false;
  }

  /* Lay out n evenly spaced positions centred inside [lo, hi]. */
  function centredTicks(lo, hi, step) {
    var span = hi - lo;
    var count = Math.floor(span / step);
    var start = lo + (span - count * step) / 2;
    var out = [];
    for (var i = 0; i <= count; i++) out.push(start + i * step);
    return out;
  }

  /* ---- templates ------------------------------------------------------ */

  var BUILDERS = {
    blank: function () { /* the markers are the only marks */ },

    lined: function (ops, ctx) {
      var s = ctx.sheet, ink = ctx.ink, kos = ctx.kos, gap = ctx.spacing;
      var x0 = MARGIN, x1 = s.w - MARGIN;
      var ys = centredTicks(MARGIN, s.h - MARGIN, gap);
      if (ctx.marginRule) {
        vRule(ops, MARGIN + 20, 0.4, MARGIN, s.h - MARGIN, ink.accent, kos);
      }
      for (var i = 0; i < ys.length; i++) hRule(ops, ys[i], 0.25, x0, x1, ink.major, kos);
    },

    squared: function (ops, ctx) {
      var s = ctx.sheet, ink = ctx.ink, kos = ctx.kos, gap = ctx.spacing;
      var xs = centredTicks(MARGIN, s.w - MARGIN, gap);
      var ys = centredTicks(MARGIN, s.h - MARGIN, gap);
      var i;
      for (i = 0; i < ys.length; i++) hRule(ops, ys[i], 0.2, xs[0], xs[xs.length - 1], ink.major, kos);
      for (i = 0; i < xs.length; i++) vRule(ops, xs[i], 0.2, ys[0], ys[ys.length - 1], ink.major, kos);
    },

    graph: function (ops, ctx) {
      var s = ctx.sheet, ink = ctx.ink, kos = ctx.kos;
      var minor = ctx.spacing, every = 5;
      var xs = centredTicks(MARGIN, s.w - MARGIN, minor);
      var ys = centredTicks(MARGIN, s.h - MARGIN, minor);
      var xa = xs[0], xb = xs[xs.length - 1], ya = ys[0], yb = ys[ys.length - 1];
      var i;
      for (i = 0; i < ys.length; i++) if (i % every) hRule(ops, ys[i], 0.13, xa, xb, ink.minor, kos);
      for (i = 0; i < xs.length; i++) if (i % every) vRule(ops, xs[i], 0.13, ya, yb, ink.minor, kos);
      for (i = 0; i < ys.length; i++) if (!(i % every)) hRule(ops, ys[i], 0.3, xa, xb, ink.major, kos);
      for (i = 0; i < xs.length; i++) if (!(i % every)) vRule(ops, xs[i], 0.3, ya, yb, ink.major, kos);
    },

    dotgrid: function (ops, ctx) {
      var s = ctx.sheet, ink = ctx.ink, kos = ctx.kos, gap = ctx.spacing;
      var xs = centredTicks(MARGIN, s.w - MARGIN, gap);
      var ys = centredTicks(MARGIN, s.h - MARGIN, gap);
      for (var j = 0; j < ys.length; j++) {
        for (var i = 0; i < xs.length; i++) {
          if (inKeepout(kos, xs[i], ys[j])) continue;
          ops.push({ k: 'circle', cx: xs[i], cy: ys[j], r: 0.32, fill: ink.major });
        }
      }
    },

    cornell: function (ops, ctx) {
      var s = ctx.sheet, ink = ctx.ink, kos = ctx.kos, gap = ctx.spacing;
      var x0 = MARGIN, x1 = s.w - MARGIN;
      var headerY = MARGIN + Math.max(14, gap * 2);
      var summaryY = s.h - MARGIN - Math.max(38, gap * 5);
      var cueX = x0 + Math.max(38, (x1 - x0) * 0.24);

      hRule(ops, headerY, 0.5, x0, x1, ink.accent, kos);
      hRule(ops, summaryY, 0.5, x0, x1, ink.accent, kos);
      vRule(ops, cueX, 0.5, headerY, summaryY, ink.accent, kos);

      for (var y = headerY + gap; y < summaryY - 0.5; y += gap) {
        hRule(ops, y, 0.2, cueX + 3, x1, ink.major, kos);
      }
      for (y = summaryY + gap; y < s.h - MARGIN; y += gap) {
        hRule(ops, y, 0.2, x0, x1, ink.major, kos);
      }
      ops.push({ k: 'text', x: x0, y: headerY - 2.6, size: 2.8, fill: ink.accent, text: 'TOPIC / DATE' });
      ops.push({ k: 'text', x: x0, y: summaryY + 4.4, size: 2.8, fill: ink.accent, text: 'SUMMARY' });
      ops.push({ k: 'text', x: x0, y: headerY + 4.4, size: 2.8, fill: ink.accent, text: 'CUES' });
    },

    music: function (ops, ctx) {
      var s = ctx.sheet, ink = ctx.ink, kos = ctx.kos;
      var lineGap = ctx.spacing * 0.3;         // 5 lines per stave
      var staveH = lineGap * 4;
      var block = staveH + ctx.spacing * 1.5;  // stave plus breathing room
      var x0 = MARGIN, x1 = s.w - MARGIN;
      var avail = (s.h - MARGIN) - MARGIN;
      var count = Math.max(1, Math.floor(avail / block));
      var top = MARGIN + (avail - (count * block - (block - staveH))) / 2;
      for (var i = 0; i < count; i++) {
        var y = top + i * block;
        for (var l = 0; l < 5; l++) {
          hRule(ops, y + l * lineGap, 0.22, x0, x1, ink.major, kos);
        }
        vRule(ops, x0, 0.22, y, y + staveH, ink.major, kos);
        vRule(ops, x1 - 0.22, 0.22, y, y + staveH, ink.major, kos);
      }
    }
  };

  var LIST = [
    { id: 'lined',   label: 'Lined',    blurb: 'Ruled writing lines',   spacing: { min: 5, max: 14, step: 0.5, def: 8,  unit: 'mm' }, marginRule: true },
    { id: 'squared', label: 'Squared',  blurb: 'Uniform square grid',   spacing: { min: 3, max: 12, step: 0.5, def: 5,  unit: 'mm' } },
    { id: 'graph',   label: 'Graph',    blurb: 'Minor + major grid',    spacing: { min: 1, max: 5,  step: 0.5, def: 2,  unit: 'mm' } },
    { id: 'dotgrid', label: 'Dot grid', blurb: 'Dots at intersections', spacing: { min: 3, max: 12, step: 0.5, def: 5,  unit: 'mm' } },
    { id: 'blank',   label: 'Blank',    blurb: 'Markers only' },
    { id: 'cornell', label: 'Cornell',  blurb: 'Cue / notes / summary', spacing: { min: 6, max: 12, step: 0.5, def: 8,  unit: 'mm' } },
    { id: 'music',   label: 'Music',    blurb: 'Five-line staves',      spacing: { min: 6, max: 16, step: 0.5, def: 8,  unit: 'mm' } }
  ];

  function byId(id) {
    for (var i = 0; i < LIST.length; i++) if (LIST[i].id === id) return LIST[i];
    return LIST[0];
  }

  function captionFor(spec) {
    var t = byId(spec.template);
    var bits = [PS.PAPER[spec.paper].label,
                spec.orientation === 'L' ? 'LANDSCAPE' : 'PORTRAIT',
                t.label.toUpperCase()];
    if (t.spacing) bits.push(spec.spacing + 'MM');
    return bits.join('  ·  ');
  }

  /* Build the ruling ops for one sheet (markers are added by the caller). */
  function build(spec) {
    var sheet = PS.sheetSize(spec.paper, spec.orientation);
    var ctx = {
      sheet: sheet,
      kos: PS.keepouts(spec.paper, spec.orientation),
      ink: INKS[spec.ink] || INKS.slate,
      spacing: spec.spacing,
      marginRule: spec.marginRule
    };
    var ops = [];
    (BUILDERS[spec.template] || BUILDERS.blank)(ops, ctx);
    if (spec.caption !== false) {
      ops.push({
        k: 'text', x: sheet.w / 2, y: sheet.h - CAPTION_PAD, size: 2.4,
        fill: '#6B7280', anchor: 'middle', text: captionFor(spec)
      });
    }
    return { sheet: sheet, ops: ops };
  }

  PS.templates = {
    LIST: LIST, INKS: INKS, INK_ORDER: INK_ORDER, MARGIN: MARGIN,
    byId: byId, build: build, caption: captionFor
  };
})(window.PS);
