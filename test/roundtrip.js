/* End-to-end: generate a sheet PDF -> render + distort it into a plausible
 * photo -> detect markers -> rectify -> measure what actually landed where.
 *
 * Two kinds of assertion:
 *   A. ink accuracy  — synthetic pen marks stamped at exact mm coordinates on
 *      blank sheets must come back within a fraction of a millimetre.
 *   B. ruling fidelity — on a lined sheet, the printed rules must reappear at
 *      the millimetre positions the generator claims to have drawn them.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { PS, ROOT } = require('./harness');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pagescan-'));
const MM_PER_IN = 25.4;
const pad = (s, n) => String(s).padEnd(n);

function genPdf(spec, file) {
  if (!spec.paper || !spec.orientation || !spec.template) {
    throw new Error('genPdf needs paper, orientation and template: ' + JSON.stringify(spec));
  }
  execFileSync('node', [path.join(ROOT, 'test/gen-pdf.js'), file,
    spec.paper, spec.orientation, spec.template], { stdio: 'pipe' });
}

function simulate(cfg) {
  const out = execFileSync('python3',
    [path.join(ROOT, 'test/simulate.py'), JSON.stringify(cfg)],
    { stdio: ['pipe', 'pipe', 'inherit'] });
  const meta = JSON.parse(out.toString());
  const buf = fs.readFileSync(cfg.raw);
  return {
    data: new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length),
    width: meta.width, height: meta.height
  };
}

/* Corners of the sheet within the simulated frame. `rotate` cycles the quad,
 * which is what happens when you photograph a page turned round. */
function quadFor(w, h, inset, skew, rotate) {
  let q = [
    [inset + skew.tl[0], inset + skew.tl[1]],
    [w - inset + skew.tr[0], inset + skew.tr[1]],
    [w - inset + skew.br[0], h - inset + skew.br[1]],
    [inset + skew.bl[0], h - inset + skew.bl[1]]
  ];
  for (let i = 0; i < (rotate || 0); i++) q = [q[3], q[0], q[1], q[2]];
  return q;
}
const FLAT = { tl: [0, 0], tr: [0, 0], br: [0, 0], bl: [0, 0] };

function inkCentroid(page, mmX, mmY, searchMm) {
  const s = page.dpi / MM_PER_IN;
  const cx = mmX * s, cy = mmY * s, r = searchMm * s;
  let sx = 0, sy = 0, n = 0;
  for (let y = Math.max(0, cx && Math.floor(cy - r)); y < Math.min(page.height, Math.ceil(cy + r)); y++) {
    for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(page.width, Math.ceil(cx + r)); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      if (page.mask[y * page.width + x]) { sx += x; sy += y; n++; }
    }
  }
  return n ? { x: sx / n / s, y: sy / n / s, px: n } : null;
}

/* Where the generator says the full-width rules sit, in mm. */
function expectedRuleRows(spec) {
  const built = PS.templates.build(spec);
  const sheet = built.sheet;
  const byY = new Map();
  for (const o of built.ops) {
    if (o.k !== 'rect' || o.h > 0.5) continue;
    byY.set(o.y, (byY.get(o.y) || 0) + o.w);
  }
  return [...byY.entries()]
    .filter(([, w]) => w > sheet.w * 0.5)
    .map(([y]) => y)
    .sort((a, b) => a - b);
}

/* Rows where the rectified page is darkest across its width.
   Measured on the greyscale rather than the ink mask: this check is about
   geometry, and a hard ink mask would only get in the way. */
function detectedRuleRows(page) {
  const s = page.dpi / MM_PER_IN;
  /* Measure only the span where a rule is actually drawn: rules are clipped
     out of the marker keep-outs, and a solid finder ring darkens a whole row
     enough to drown one out. Vertically only the page-edge trim is skipped. */
  const trim = Math.round((PS.MARK.inset + PS.MARK.finder / 2 + PS.MARK.quiet) * s);
  const vtrim = Math.round(3 * s);
  const rowMean = new Float64Array(page.height);
  for (let y = 0; y < page.height; y++) {
    let sum = 0;
    for (let x = trim; x < page.width - trim; x++) sum += page.gray[y * page.width + x];
    rowMean[y] = sum / (page.width - 2 * trim);
  }
  /* Local baseline over a window wider than the rule spacing, so a rule
     shows up as a dip regardless of overall page lighting. */
  const win = Math.round(3 * s);
  const rows = [];
  for (let y = vtrim; y < page.height - vtrim; y++) {
    let base = 0, n = 0;
    for (let d = -win * 3; d <= win * 3; d += 1) {
      const yy = y + d;
      if (yy < 0 || yy >= page.height) continue;
      base += rowMean[yy]; n++;
    }
    base /= n;
    if (rowMean[y] > base - 4) continue;       // not dark enough to be a rule
    let peak = true;
    for (let d = -2; d <= 2; d++) {
      const yy = y + d;
      if (yy >= 0 && yy < page.height && rowMean[yy] < rowMean[y] - 1e-9) { peak = false; break; }
    }
    if (!peak) continue;
    /* Sub-pixel centre from the darkness deficit around the peak. */
    let num = 0, den = 0;
    for (let d = -2; d <= 2; d++) {
      const yy = y + d;
      if (yy < 0 || yy >= page.height) continue;
      const wgt = Math.max(0, base - rowMean[yy]);
      num += yy * wgt; den += wgt;
    }
    if (den > 0) rows.push(num / den / s);
  }
  /* Collapse neighbouring detections of the same rule. */
  const merged = [];
  for (const r of rows.sort((a, b) => a - b)) {
    if (merged.length && r - merged[merged.length - 1] < 1.5) continue;
    merged.push(r);
  }
  return merged;
}

const ACCURACY = [
  /* Frame sizes and source DPI are chosen to mimic what a phone or flatbed
     actually produces: a 10.5mm finder needs roughly 4px per module to read. */
  { name: 'A4 portrait, flat',           paper: 'A4', orientation: 'P', dpi: 260, frame: [2000, 2700], inset: 80,  skew: FLAT, blur: 0, noise: 1.5 },
  { name: 'A4 portrait, moderate angle', paper: 'A4', orientation: 'P', dpi: 260, frame: [2000, 2700], inset: 95,  skew: { tl: [55, 34], tr: [-95, 14], br: [20, -75], bl: [-40, -20] }, blur: 1, noise: 3 },
  { name: 'A4 portrait, steep angle',    paper: 'A4', orientation: 'P', dpi: 260, frame: [2100, 2800], inset: 150, skew: { tl: [125, 95], tr: [-165, 40], br: [70, -150], bl: [-95, -55] }, blur: 2, noise: 6 },
  { name: 'A4 portrait, upside down',    paper: 'A4', orientation: 'P', dpi: 260, frame: [2000, 2700], inset: 85,  skew: { tl: [34, 20], tr: [-48, 14], br: [16, -38], bl: [-22, -14] }, rotate: 2, blur: 1, noise: 2 },
  { name: 'A4 landscape',                paper: 'A4', orientation: 'L', dpi: 260, frame: [2700, 2000], inset: 80,  skew: { tl: [34, 24], tr: [-54, 7], br: [14, -47], bl: [-24, -14] }, blur: 1, noise: 2 },
  { name: 'A5 portrait',                 paper: 'A5', orientation: 'P', dpi: 300, frame: [1650, 2250], inset: 72,  skew: { tl: [26, 18], tr: [-40, 11], br: [16, -34], bl: [-18, -12] }, blur: 1, noise: 2 },
  { name: 'A5 landscape',                paper: 'A5', orientation: 'L', dpi: 300, frame: [2250, 1650], inset: 72,  skew: { tl: [29, 16], tr: [-37, 12], br: [18, -29], bl: [-21, -10] }, blur: 1, noise: 2 },
  { name: 'Letter portrait',             paper: 'LT', orientation: 'P', dpi: 260, frame: [2050, 2650], inset: 80,  skew: { tl: [40, 26], tr: [-60, 16], br: [24, -40], bl: [-29, -16] }, blur: 1, noise: 2 },
  { name: 'Legal portrait',              paper: 'LG', orientation: 'P', dpi: 240, frame: [1950, 3000], inset: 78,  skew: { tl: [37, 24], tr: [-53, 13], br: [21, -40], bl: [-26, -13] }, blur: 1, noise: 2 },
  { name: 'A3 landscape',                paper: 'A3', orientation: 'L', dpi: 200, frame: [2700, 2000], inset: 85,  skew: { tl: [37, 27], tr: [-58, 17], br: [24, -41], bl: [-30, -17] }, blur: 1, noise: 2 },
  { name: 'A4 portrait, dim + grainy',   paper: 'A4', orientation: 'P', dpi: 240, frame: [1900, 2500], inset: 75,  skew: { tl: [40, 26], tr: [-52, 16], br: [20, -39], bl: [-26, -16] }, blur: 2, noise: 11 },
  { name: 'A4 portrait, small capture',  paper: 'A4', orientation: 'P', dpi: 180, frame: [1250, 1700], inset: 50,  skew: { tl: [18, 12], tr: [-26, 7], br: [10, -20], bl: [-13, -8] }, blur: 1, noise: 3 }
];

const MARK_FRACTIONS = [[0.28, 0.34], [0.71, 0.62], [0.5, 0.82], [0.33, 0.72], [0.62, 0.28]];

let failures = 0;
const rows = [];

console.log('\n== A. ink accuracy (blank sheets, marks stamped at known mm) ==\n');
console.log(pad('case', 34) + pad('marks', 7) + pad('page', 8) + pad('out dpi', 18) + pad('worst err', 11) + pad('ms', 9) + 'status');
console.log('-'.repeat(112));

for (const c of ACCURACY) {
  const sheet = PS.sheetSize(c.paper, c.orientation);
  const pdf = path.join(TMP, `${c.paper}-${c.orientation}-blank.pdf`);
  genPdf({ ...c, template: 'blank' }, pdf);
  const marks = MARK_FRACTIONS.map(([fx, fy]) => [+(sheet.w * fx).toFixed(2), +(sheet.h * fy).toFixed(2), 2.2]);

  const img = simulate({
    pdf, dpi: c.dpi, raw: path.join(TMP, 'frame.raw'), out: c.frame,
    quad: quadFor(c.frame[0], c.frame[1], c.inset, c.skew, c.rotate),
    marks, blur: c.blur, noise: c.noise, seed: 11
  });

  const t0 = Date.now();
  /* Paper size is told to the scanner — bare registration patterns carry no
     payload, and A3/A4/A5 are the same shape. Orientation is not: it has to
     come out of the marker geometry. */
  const det = PS.scanner.detect(img, { paper: c.paper });
  const tDetect = Date.now() - t0;

  const problems = [];
  if (!det.ok) problems.push(`detect failed (${det.reason})`);
  if (det.found.length !== 4) problems.push(`found ${det.found.length}/4 markers`);
  if (det.paper !== c.paper) problems.push(`read paper ${det.paper}, expected ${c.paper}`);
  if (det.orientation !== c.orientation) problems.push(`read orientation ${det.orientation}`);

  let worst = NaN, page = null, tRect = 0;
  if (det.ok) {
    const t1 = Date.now();
    page = PS.scanner.rectify(img, det, { dpi: 200, strength: 55, hideMarkers: true });
    tRect = Date.now() - t1;
    if (!page) problems.push('rectify returned null');
    else {
      if (Math.abs(page.width / page.dpi * MM_PER_IN - sheet.w) > 0.6) problems.push('output width wrong');
      worst = 0;
      for (const [mx, my] of marks) {
        const got = inkCentroid(page, mx, my, 5);
        if (!got || got.px < 12) { problems.push(`ink at ${mx},${my}mm lost`); worst = Infinity; break; }
        worst = Math.max(worst, Math.hypot(got.x - mx, got.y - my));
      }
      if (worst > 0.6) problems.push(`ink off by ${worst.toFixed(2)}mm`);
    }
  }
  if (problems.length) failures++;
  console.log(pad(c.name, 34) + pad(`${det.found.length}/4`, 7) +
    pad(det.paper ? `${det.paper}/${det.orientation}` : '-', 8) +
    pad(page ? `${page.dpi} (native ${page.nativeDpi})` : '-', 18) +
    pad(Number.isFinite(worst) ? `${worst.toFixed(2)}mm` : '-', 11) +
    pad(`${tDetect}+${tRect}`, 9) +
    (problems.length ? 'FAIL: ' + problems.join('; ') : 'pass'));
}

console.log('\n== B. ruling fidelity (printed rules must return to their stated mm) ==\n');
console.log(pad('case', 34) + pad('rules', 10) + pad('worst err', 11) + 'status');
console.log('-'.repeat(112));

const RULED = [
  { name: 'A4 portrait lined 8mm',  paper: 'A4', orientation: 'P', template: 'lined', dpi: 300, frame: [2100, 2800], inset: 90, skew: { tl: [45, 30], tr: [-72, 16], br: [24, -58], bl: [-33, -18] } },
  { name: 'A4 landscape lined 8mm', paper: 'A4', orientation: 'L', template: 'lined', dpi: 300, frame: [2800, 2100], inset: 90, skew: { tl: [39, 26], tr: [-58, 13], br: [20, -46], bl: [-26, -16] } },
  { name: 'A5 portrait lined 8mm',  paper: 'A5', orientation: 'P', template: 'lined', dpi: 320, frame: [1700, 2320], inset: 75, skew: { tl: [31, 21], tr: [-44, 12], br: [17, -35], bl: [-22, -13] } }
];

for (const c of RULED) {
  const spec = { paper: c.paper, orientation: c.orientation, template: 'lined', ink: 'blue', spacing: 8, marginRule: true };
  const pdf = path.join(TMP, `${c.paper}-${c.orientation}-lined.pdf`);
  genPdf(c, pdf);
  const img = simulate({
    pdf, dpi: c.dpi, raw: path.join(TMP, 'frame.raw'), out: c.frame,
    quad: quadFor(c.frame[0], c.frame[1], c.inset, c.skew, c.rotate),
    marks: [], blur: 1, noise: 2, seed: 5
  });

  const det = PS.scanner.detect(img, { paper: c.paper });
  const problems = [];
  let worst = NaN, matched = 0, expected = [];
  if (!det.ok) problems.push(`detect failed (${det.reason})`);
  else {
    const page = PS.scanner.rectify(img, det, { dpi: 220, strength: 55, hideMarkers: true });
    expected = expectedRuleRows(spec);
    const got = detectedRuleRows(page);
    worst = 0;
    for (const e of expected) {
      let best = Infinity;
      for (const g of got) best = Math.min(best, Math.abs(g - e));
      if (best < 1.0) { matched++; worst = Math.max(worst, best); }
    }
    if (matched < expected.length * 0.9) problems.push(`only ${matched}/${expected.length} rules recovered`);
    if (worst > 0.5) problems.push(`rule off by ${worst.toFixed(2)}mm`);
  }
  if (problems.length) failures++;
  console.log(pad(c.name, 34) + pad(`${matched}/${expected.length}`, 10) +
    pad(Number.isFinite(worst) ? `${worst.toFixed(2)}mm` : '-', 11) +
    (problems.length ? 'FAIL: ' + problems.join('; ') : 'pass'));
}

console.log('\n== C. degraded input ==\n');
console.log(pad('case', 34) + pad('marks', 7) + pad('mode', 12) + pad('worst err', 11) + 'status');
console.log('-'.repeat(112));

/* A flatbed scan with one corner clipped off the platen. There is no
   perspective in a flatbed capture, so the three-marker affine fallback is
   the right model and should still place ink accurately. */
{
  const sheet = PS.sheetSize('A4', 'P');
  const pdf = path.join(TMP, 'A4-P-blank.pdf');
  const marks = MARK_FRACTIONS.map(([fx, fy]) => [+(sheet.w * fx).toFixed(2), +(sheet.h * fy).toFixed(2), 2.2]);
  const frame = [2000, 2900];
  /* Sheet sits rotated on the platen so its top-right corner — and only
     that corner — falls outside the scanned area. */
  const img = simulate({
    pdf, dpi: 260, raw: path.join(TMP, 'frame.raw'), out: frame,
    quad: [[380, 60], [2140, 245], [1878, 2734], [118, 2549]],
    marks, blur: 1, noise: 2, seed: 3, light: false
  });
  const det = PS.scanner.detect(img, { paper: 'A4' });
  const problems = [];
  let worst = NaN, mode = '-';
  if (!det.ok) problems.push(`detect failed (${det.reason})`);
  else {
    mode = det.exact ? 'homography' : `affine(${det.found.length})`;
    if (det.exact) problems.push('expected a clipped corner, got all four');
    const page = PS.scanner.rectify(img, det, { dpi: 200, strength: 55 });
    worst = 0;
    for (const [mx, my] of marks) {
      const got = inkCentroid(page, mx, my, 6);
      if (!got || got.px < 12) { worst = Infinity; break; }
      worst = Math.max(worst, Math.hypot(got.x - mx, got.y - my));
    }
    if (!(worst < 1.0)) problems.push(`ink off by ${worst.toFixed ? worst.toFixed(2) + 'mm' : worst}`);
  }
  if (problems.length) failures++;
  console.log(pad('A4 flatbed, one corner clipped', 34) + pad(`${det.found.length}/4`, 7) + pad(mode, 12) +
    pad(Number.isFinite(worst) ? `${worst.toFixed(2)}mm` : '-', 11) +
    (problems.length ? 'FAIL: ' + problems.join('; ') : 'pass'));
}

/* No markers at all: must fail cleanly rather than throw. */
{
  const blankImg = { data: new Uint8ClampedArray(400 * 400 * 4).fill(255), width: 400, height: 400 };
  const det = PS.scanner.detect(blankImg, { paper: 'A4' });
  const ok = det.ok === false && det.reason === 'no-markers';
  if (!ok) failures++;
  console.log(pad('blank frame, no markers', 34) + pad('0/4', 7) + pad('-', 12) + pad('-', 11) +
    (ok ? 'pass' : 'FAIL: expected a clean no-markers result'));
}

console.log('-'.repeat(112));
console.log(failures ? `\n${failures} check(s) FAILED\n` : `\nall checks passed\n`);
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
