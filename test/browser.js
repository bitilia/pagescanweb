/* Drives the real app in Chromium: generates a sheet PDF through the UI,
 * feeds synthetic photographs into the scanner, and exports the result.
 * Both PDFs are checked for page geometry afterwards. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const FIXTURES = process.env.PS_FIXTURES || require('./make-fixtures')
  .build(fs.mkdtempSync(path.join(os.tmpdir(), 'pagescan-photos-')));
const OUT = process.env.PS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'pagescan-ui-'));

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.woff2': 'font/woff2' };

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]);
      const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail: detail || '' });
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

(async () => {
  const { server, port } = await serve();
  const browser = await chromium.launch({ executablePath: process.env.PS_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  const errors = [];          // uncaught JS exceptions
  const resourceErrors = [];  // failed loads (fonts, favicons, …)
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    (/Failed to load resource/.test(m.text()) ? resourceErrors : errors).push(m.text());
  });
  page.on('requestfailed', r => resourceErrors.push(r.url()));

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });

  /* ---- generator ---- */
  check('generator renders a preview',
    await page.locator('#preview svg').count() === 1);

  /* Three seven-module finders at 15 runs each, plus the five-module
     alignment square at 9. */
  const markerRects = await page.evaluate(() =>
    window.PS.marker.ops('A4', 'P').length);
  check('four markers are drawn as vector runs', markerRects === 54, `${markerRects} rects`);

  /* every template must render without throwing */
  for (const t of await page.evaluate(() => window.PS.templates.LIST.map(x => x.id))) {
    await page.click(`[data-template="${t}"]`);
    const ok = await page.locator('#preview svg').count() === 1;
    if (!ok) check(`template ${t} renders`, false);
  }
  check('all templates render without error', errors.length === 0, errors.slice(0, 2).join(' | '));

  await page.click('[data-template="lined"]');
  await page.click('[data-paper="A4"]');
  await page.click('[data-orientation="P"]');
  await page.screenshot({ path: path.join(OUT, 'generate.png'), fullPage: false });

  /* landscape + graph, for the screenshot record */
  await page.click('[data-template="graph"]');
  await page.click('[data-orientation="L"]');
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, 'generate-graph.png') });
  await page.click('[data-template="lined"]');
  await page.click('[data-orientation="P"]');

  const genDownload = page.waitForEvent('download');
  await page.click('#download-sheets');
  const sheetPdf = path.join(OUT, 'sheets.pdf');
  await (await genDownload).saveAs(sheetPdf);
  check('sheet PDF downloads', fs.existsSync(sheetPdf) && fs.statSync(sheetPdf).size > 1000,
    `${(fs.statSync(sheetPdf).size / 1024).toFixed(0)} KB`);

  /* ---- scanner ---- */
  await page.click('[data-mode="scan"]');
  await page.waitForTimeout(200);

  /* The markers carry no payload, so the paper size is picked here. The two
     A4 shots go in together; the A5 one after switching the control, which is
     also what proves the control is wired up. */
  const photo = f => path.join(FIXTURES, f);
  await page.click('[data-scan-paper="A4"]');

  /* The capture confirmation must start out of the way. */
  const confirmHidden = await page.evaluate(() => {
    const el = document.getElementById('camera-confirm');
    return !!el && getComputedStyle(el).visibility === 'hidden';
  });
  check('capture confirmation starts hidden', confirmHidden);

  await page.setInputFiles('#file-input', [photo('photo1.png'), photo('photo2.png')]);
  /* A page that has just landed marks itself, so a capture is visible on the
     card and not only in the log. */
  await page.waitForSelector('.pagecard.is-new', { timeout: 180000 });
  check('a new page card announces itself', true);
  await page.waitForFunction(() => document.querySelectorAll('.pagecard').length === 2, { timeout: 180000 });

  await page.click('[data-scan-paper="A5"]');
  await page.setInputFiles('#file-input', [photo('photo3.png')]);
  await page.waitForFunction(() => document.querySelectorAll('.pagecard').length === 3, { timeout: 180000 });

  const cards = await page.$$eval('.pagecard', els => els.map(e => ({
    title: e.querySelector('.pagecard__title').textContent,
    badges: [...e.querySelectorAll('.badge')].map(b => b.textContent)
  })));
  check('all three photos became pages', cards.length === 3);
  /* Orientation is not told to the scanner — it comes out of the geometry. */
  check('page 1 squared up as A4 portrait', cards[0].badges[0] === 'A4 portrait', cards[0].badges.join(', '));
  check('page 2 squared up as A4 landscape', cards[1].badges[0] === 'A4 landscape', cards[1].badges.join(', '));
  check('page 3 squared up as A5 portrait', cards[2].badges[0] === 'A5 portrait', cards[2].badges.join(', '));
  check('no page fell back to 3 markers',
    !cards.some(c => c.badges.includes('3 markers')));

  /* The flash is temporary: the card settles back on its own. */
  await page.waitForFunction(() => !document.querySelector('.pagecard.is-new'), { timeout: 8000 });
  check('the new-page flash clears itself', true);

  await page.screenshot({ path: path.join(OUT, 'scan.png') });

  /* reorder, then export */
  await page.click('.pagecard:nth-child(3) [data-act="up"]');
  const reordered = await page.$$eval('.pagecard .pagecard__title', els => els.map(e => e.textContent));
  /* photo3 was third; moving it up must put it second, and renumber the labels. */
  check('pages reorder',
    /^1\. photo1/.test(reordered[0]) && /^2\. photo3/.test(reordered[1]) && /^3\. photo2/.test(reordered[2]),
    reordered.join(' | '));

  const scanDownload = page.waitForEvent('download');
  await page.click('#download-scan');
  const scanPdf = path.join(OUT, 'scanned.pdf');
  await (await scanDownload).saveAs(scanPdf);
  check('scanned PDF downloads', fs.existsSync(scanPdf) && fs.statSync(scanPdf).size > 1000,
    `${(fs.statSync(scanPdf).size / 1024).toFixed(0)} KB`);

  /* ---- responsive smoke ---- */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no horizontal overflow on a phone viewport', overflow <= 1, `${overflow}px`);
  await page.screenshot({ path: path.join(OUT, 'scan-mobile.png'), fullPage: false });
  await page.click('[data-mode="generate"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, 'generate-mobile.png'), fullPage: false });

  check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('every asset loads (app is fully self-hosted)', resourceErrors.length === 0,
    resourceErrors.slice(0, 3).join(' | '));

  await browser.close();
  server.close();

  console.log('\nartifacts in ' + OUT);
  const failed = results.filter(r => !r.ok).length;
  console.log(failed ? `\n${failed} check(s) FAILED\n` : '\nall browser checks passed\n');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
