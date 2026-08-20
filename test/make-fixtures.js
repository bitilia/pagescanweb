/* Synthesise the photographs the browser suite feeds through the scan view:
 * a real sheet PDF, rendered, warped into a plausible camera frame and saved
 * as a PNG the file input can accept. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ROOT } = require('./harness');

const SHOTS = [
  { file: 'photo1.png', paper: 'A4', orientation: 'P', template: 'lined', dpi: 260, out: [2000, 2700],
    skew: { tl: [40, 26], tr: [-52, 16], br: [20, -39], bl: [-26, -16] } },
  { file: 'photo2.png', paper: 'A4', orientation: 'L', template: 'squared', dpi: 260, out: [2700, 2000],
    skew: { tl: [34, 24], tr: [-54, 7], br: [14, -47], bl: [-24, -14] } },
  { file: 'photo3.png', paper: 'A5', orientation: 'P', template: 'graph', dpi: 300, out: [1650, 2250],
    skew: { tl: [26, 18], tr: [-40, 11], br: [16, -34], bl: [-18, -12] } }
];

function build(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pagescan-fix-'));
  for (const s of SHOTS) {
    const pdf = path.join(tmp, s.file + '.pdf');
    execFileSync('node', [path.join(ROOT, 'test/gen-pdf.js'), pdf, s.paper, s.orientation, s.template],
      { stdio: 'pipe' });
    const [w, h] = s.out, i = Math.round(Math.min(w, h) * 0.04);
    execFileSync('python3', [path.join(ROOT, 'test/simulate.py'), JSON.stringify({
      pdf, dpi: s.dpi, out: s.out, png: path.join(dir, s.file), blur: 1, noise: 3, seed: 4,
      marks: [[s.paper === 'A5' ? 60 : 90, 120, 2.4], [s.paper === 'A5' ? 90 : 140, 170, 1.8]],
      quad: [
        [i + s.skew.tl[0], i + s.skew.tl[1]], [w - i + s.skew.tr[0], i + s.skew.tr[1]],
        [w - i + s.skew.br[0], h - i + s.skew.br[1]], [i + s.skew.bl[0], h - i + s.skew.bl[1]]
      ]
    })], { stdio: ['pipe', 'pipe', 'inherit'] });
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  return dir;
}

module.exports = { build, SHOTS };

if (require.main === module) {
  console.log(build(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'pagescan-photos-'))));
}
