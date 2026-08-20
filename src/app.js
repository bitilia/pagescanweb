/* PageScan — user interface.
 * Classic scripts and a shared PS namespace rather than ES modules, so the
 * whole app runs straight from a file:// path with nothing to install. */
(function (PS) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  /* Let the browser paint between heavy synchronous steps. */
  function yieldToPaint() {
    return new Promise(function (resolve) {
      requestAnimationFrame(function () { setTimeout(resolve, 0); });
    });
  }

  async function withBusy(button, label, work) {
    var original = button.innerHTML;
    button.classList.add('is-busy');
    button.innerHTML = label;
    await yieldToPaint();
    try { return await work(); }
    finally { button.classList.remove('is-busy'); button.innerHTML = original; }
  }

  /* =======================================================================
   * Generate
   * ===================================================================== */

  var gen = {
    template: 'lined', paper: 'A4', orientation: 'P',
    ink: 'blue', spacing: 8, marginRule: true, pages: 4
  };

  /* Tile thumbnails are drawn at tile scale rather than shrinking the real
   * sheet: at 60px wide the actual rules would fall below one pixel. The
   * corner markers are the shared motif — every sheet has them, three large
   * and one small, in that arrangement. */
  function tileArt(id) {
    var body = '';
    var line = function (y) { return '<rect x="4" y="' + y + '" width="22" height="0.9" opacity="0.55"/>'; };
    if (id === 'lined') {
      for (var y = 12; y <= 30; y += 4.5) body += line(y);
    } else if (id === 'squared') {
      for (y = 11; y <= 31; y += 5) body += line(y);
      for (var x = 5; x <= 25; x += 5) body += '<rect x="' + x + '" y="11" width="0.9" height="20" opacity="0.55"/>';
    } else if (id === 'graph') {
      for (y = 9; y <= 33; y += 2.4) body += '<rect x="4" y="' + y + '" width="22" height="0.6" opacity="0.3"/>';
      for (x = 4; x <= 26; x += 2.4) body += '<rect x="' + x + '" y="9" width="0.6" height="24" opacity="0.3"/>';
      body += '<rect x="4" y="21" width="22" height="1" opacity="0.75"/><rect x="14.6" y="9" width="1" height="24" opacity="0.75"/>';
    } else if (id === 'dotgrid') {
      for (y = 11; y <= 31; y += 4) for (x = 5; x <= 25; x += 4) body += '<circle cx="' + x + '" cy="' + y + '" r="0.8" opacity="0.6"/>';
    } else if (id === 'cornell') {
      body += line(12) + line(31);
      body += '<rect x="11" y="12" width="0.9" height="19" opacity="0.55"/>';
      for (y = 16; y <= 29; y += 4) body += '<rect x="13" y="' + y + '" width="13" height="0.7" opacity="0.35"/>';
    } else if (id === 'music') {
      /* Two staves rather than a faithful count: at tile scale, five lines
         plus a real gap is what reads as a stave. */
      for (var g = 0; g < 2; g++) for (var l = 0; l < 5; l++) body += line(11 + g * 16 + l * 2.2);
    }
    /* corner markers: finders at TL, TR and BL, the smaller alignment square
       at BR — the same asymmetry that tells the scanner which way is up */
    [[3, 3, 3.4], [23.6, 3, 3.4], [3, 33.6, 3.4], [24.6, 34.6, 2.4]].forEach(function (p) {
      body += '<rect x="' + p[0] + '" y="' + p[1] + '" width="' + p[2] +
        '" height="' + p[2] + '" rx="0.3" opacity="0.9"/>';
    });
    return '<svg class="tile__art" viewBox="0 0 30 40" fill="currentColor" aria-hidden="true">' + body + '</svg>';
  }

  function buildTemplateTiles() {
    $('template-tiles').innerHTML = PS.templates.LIST.map(function (t) {
      return '<button type="button" class="tile' + (t.id === gen.template ? ' is-active' : '') +
        '" data-template="' + t.id + '" title="' + t.blurb + '" aria-pressed="' +
        (t.id === gen.template) + '">' + tileArt(t.id) +
        '<span class="tile__name">' + t.label + '</span></button>';
    }).join('');
  }

  function buildPaperSegments() {
    $('paper-segments').innerHTML = PS.PAPER_ORDER.map(function (code) {
      return '<button type="button" class="segment' + (code === gen.paper ? ' is-active' : '') +
        '" data-paper="' + code + '" aria-pressed="' + (code === gen.paper) + '">' +
        PS.PAPER[code].label + '</button>';
    }).join('');
  }

  function buildOrientationSegments() {
    $('orientation-segments').innerHTML = [['P', 'Portrait'], ['L', 'Landscape']].map(function (o) {
      return '<button type="button" class="segment' + (o[0] === gen.orientation ? ' is-active' : '') +
        '" data-orientation="' + o[0] + '" aria-pressed="' + (o[0] === gen.orientation) + '">' +
        o[1] + '</button>';
    }).join('');
  }

  function buildInkSwatches() {
    $('ink-swatches').innerHTML = PS.templates.INK_ORDER.map(function (key) {
      var ink = PS.templates.INKS[key];
      return '<button type="button" class="swatch' + (key === gen.ink ? ' is-active' : '') +
        '" data-ink="' + key + '" aria-pressed="' + (key === gen.ink) + '">' +
        '<span class="swatch__dot" style="background:' + ink.swatch + '"></span>' +
        '<span>' + ink.label + '</span></button>';
    }).join('');
  }

  function syncTemplateOptions() {
    var t = PS.templates.byId(gen.template);
    var group = $('spacing-group'), slider = $('spacing');
    if (t.spacing) {
      group.classList.remove('is-hidden');
      slider.min = t.spacing.min;
      slider.max = t.spacing.max;
      slider.step = t.spacing.step;
      if (gen.spacing < t.spacing.min || gen.spacing > t.spacing.max) gen.spacing = t.spacing.def;
      slider.value = gen.spacing;
      $('spacing-value').textContent = gen.spacing + t.spacing.unit;
    } else {
      group.classList.add('is-hidden');
    }
    $('margin-group').classList.toggle('is-hidden', !t.marginRule);
  }

  function renderGenerate() {
    syncTemplateOptions();
    var spec = {
      paper: gen.paper, orientation: gen.orientation, template: gen.template,
      ink: gen.ink, spacing: gen.spacing, marginRule: gen.marginRule
    };
    $('preview').innerHTML = PS.generator.preview(spec);

    var sheet = PS.sheetSize(gen.paper, gen.orientation);
    var t = PS.templates.byId(gen.template);
    var facts = [
      ['Sheet', PS.PAPER[gen.paper].label + ' ' + (gen.orientation === 'L' ? 'landscape' : 'portrait')],
      ['Size', sheet.w + ' × ' + sheet.h + ' mm'],
      [t.spacing ? 'Spacing' : 'Ruling', t.spacing ? gen.spacing + ' mm' : t.label],
      ['Markers', '3 × ' + PS.MARK.finder + ' mm + 1 × ' + PS.MARK.align + ' mm']
    ];
    $('preview-facts').innerHTML = facts.map(function (f) {
      return '<div><dt>' + f[0] + '</dt><dd>' + f[1] + '</dd></div>';
    }).join('');

    $('download-sheets').innerHTML = PS.icon('download') +
      '<span>Download ' + gen.pages + ' page' + (gen.pages === 1 ? '' : 's') + '</span>';
    $('print-sheets').innerHTML = PS.icon('printer') + '<span>Open for printing</span>';
  }

  function currentSpec() {
    return {
      paper: gen.paper, orientation: gen.orientation, template: gen.template,
      ink: gen.ink, spacing: gen.spacing, marginRule: gen.marginRule
    };
  }

  function pickOne(container, attr, key) {
    container.addEventListener('click', function (event) {
      var button = event.target.closest('[data-' + attr + ']');
      if (!button) return;
      gen[key] = button.getAttribute('data-' + attr);
      Array.prototype.forEach.call(container.children, function (child) {
        var on = child === button;
        child.classList.toggle('is-active', on);
        child.setAttribute('aria-pressed', String(on));
      });
      renderGenerate();
    });
  }

  function initGenerate() {
    buildTemplateTiles();
    buildPaperSegments();
    buildOrientationSegments();
    buildInkSwatches();

    pickOne($('template-tiles'), 'template', 'template');
    pickOne($('paper-segments'), 'paper', 'paper');
    pickOne($('orientation-segments'), 'orientation', 'orientation');
    pickOne($('ink-swatches'), 'ink', 'ink');

    $('spacing').addEventListener('input', function () {
      gen.spacing = parseFloat(this.value);
      renderGenerate();
    });
    $('margin-rule').addEventListener('change', function () {
      gen.marginRule = this.checked;
      renderGenerate();
    });

    function setPages(n) {
      gen.pages = Math.max(1, Math.min(200, n || 1));
      $('pages').value = gen.pages;
      renderGenerate();
    }
    $('pages').addEventListener('change', function () { setPages(parseInt(this.value, 10)); });
    $('pages-minus').addEventListener('click', function () { setPages(gen.pages - 1); });
    $('pages-plus').addEventListener('click', function () { setPages(gen.pages + 1); });

    $('download-sheets').addEventListener('click', function () {
      var button = this;
      withBusy(button, '<span>Building PDF…</span>', async function () {
        var spec = currentSpec();
        var blob = await PS.generator.toPDF(spec, gen.pages);
        download(blob, PS.generator.filename(spec, gen.pages));
      });
    });

    $('print-sheets').addEventListener('click', function () {
      var button = this;
      withBusy(button, '<span>Preparing…</span>', async function () {
        var blob = await PS.generator.toPDF(currentSpec(), gen.pages);
        var url = URL.createObjectURL(blob);
        var win = window.open(url, '_blank');
        if (!win) download(blob, PS.generator.filename(currentSpec(), gen.pages));
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      });
    });

    renderGenerate();
  }

  /* =======================================================================
   * Scan
   * ===================================================================== */

  /* Paper size is the one thing the markers cannot tell us: they carry no
   * payload, and A4, A5 and A3 are all the same shape. */
  var scan = { paper: 'A4', dpi: 200, strength: 55, hideMarkers: true, pages: [], busy: false };
  var MAX_SOURCE_DIM = 4200;   // beyond this we gain nothing but memory pressure

  function log(kind, text) {
    var box = $('log');
    var line = document.createElement('p');
    line.className = 'log__line log__line--' + kind;
    line.textContent = text;
    box.appendChild(line);
    while (box.children.length > 6) box.removeChild(box.firstChild);
    return line;
  }

  async function imageDataFrom(source) {
    var bitmap;
    try {
      bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
    } catch (e) {
      bitmap = await createImageBitmap(source);
    }
    var scaleDown = Math.min(1, MAX_SOURCE_DIM / Math.max(bitmap.width, bitmap.height));
    var w = Math.round(bitmap.width * scaleDown), h = Math.round(bitmap.height * scaleDown);
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, w, h);
    if (bitmap.close) bitmap.close();
    return ctx.getImageData(0, 0, w, h);
  }

  function describeFailure(detection) {
    if (!detection || !detection.found.length) {
      return 'no corner markers found — is the whole sheet in frame, and in focus?';
    }
    if (detection.reason === 'collinear') {
      return 'the markers came out in a line, so the page cannot be squared up.';
    }
    return 'only ' + detection.found.length + ' of 4 corner markers found — at least 3 ' +
      'are needed, and a marker cut off by the edge of the frame cannot be read.';
  }

  async function addCapture(source, name) {
    var line = log('busy', 'Reading ' + name + '…');
    await yieldToPaint();
    try {
      var img = await imageDataFrom(source);
      line.textContent = 'Finding corner markers in ' + name + '…';
      await yieldToPaint();

      var detection = PS.scanner.detect(img, { paper: scan.paper });
      if (!detection.ok) {
        line.className = 'log__line log__line--error';
        line.textContent = name + ': ' + describeFailure(detection);
        return false;
      }

      line.textContent = 'Squaring up ' + name + '…';
      await yieldToPaint();

      var rect = PS.scanner.rectify(img, detection, {
        dpi: scan.dpi, strength: scan.strength, hideMarkers: scan.hideMarkers
      });
      if (!rect) {
        line.className = 'log__line log__line--error';
        line.textContent = name + ': the markers are collinear, so the page cannot be squared up.';
        return false;
      }

      scan.pages.push(PS.pages.makePage(rect, { name: name }));
      renderPages();

      var label = PS.PAPER[rect.paper].label + ' ' + (rect.orientation === 'L' ? 'landscape' : 'portrait');
      if (rect.exact) {
        line.className = 'log__line log__line--ok';
        line.textContent = name + ': ' + label + ' at ' + rect.dpi + ' dpi.';
      } else {
        line.className = 'log__line log__line--warn';
        line.textContent = name + ': ' + label + ' from 3 markers — squared up without ' +
          'perspective correction, so check the result if it was a photo.';
      }
      return true;
    } catch (err) {
      line.className = 'log__line log__line--error';
      line.textContent = /\.hei[cf]$/i.test(name)
        ? name + ': browsers cannot open HEIC. Export it as JPEG first — on iPhone, ' +
          'Settings › Camera › Formats › Most Compatible saves photos as JPEG.'
        : name + ': could not be read (' + (err && err.message ? err.message : err) + ').';
      return false;
    }
  }

  async function addFiles(files) {
    if (scan.busy) {
      log('warn', 'Still working through the last batch — try again in a moment.');
      return;
    }
    var images = Array.prototype.filter.call(files, function (f) { return /^image\//.test(f.type); });
    if (!images.length) {
      log('error', 'Those files are not images. Add JPG, PNG or WebP photos of your sheets.');
      return;
    }
    scan.busy = true;
    for (var i = 0; i < images.length; i++) {
      await addCapture(images[i], images[i].name);
    }
    scan.busy = false;
  }

  function renderPages() {
    var list = $('pagelist');
    var count = scan.pages.length;
    $('results-empty').classList.toggle('is-hidden', count > 0);
    $('page-count').textContent = count ? count + (count === 1 ? ' page' : ' pages') : 'None yet';
    $('download-scan').disabled = !count;
    $('clear-pages').disabled = !count;
    $('download-scan').innerHTML = PS.icon('download') +
      '<span>' + (count ? 'Download PDF · ' + count + (count === 1 ? ' page' : ' pages') : 'Download PDF') + '</span>';
    $('clear-pages').innerHTML = PS.icon('trash') + '<span>Clear all</span>';

    list.innerHTML = '';
    scan.pages.forEach(function (page, index) {
      var li = document.createElement('li');
      li.className = 'pagecard';
      li.draggable = true;
      li.dataset.index = String(index);

      var thumb = PS.pages.thumbnail(page, 150);
      thumb.className = 'pagecard__thumb';
      thumb.setAttribute('alt', '');

      var body = document.createElement('div');
      body.className = 'pagecard__body';
      var title = document.createElement('p');
      title.className = 'pagecard__title';
      title.textContent = (index + 1) + '. ' + (page.name || 'Capture');
      var meta = document.createElement('div');
      meta.className = 'pagecard__meta';
      meta.innerHTML =
        '<span class="badge badge--ok">' + PS.PAPER[page.paper].label + ' ' +
        (page.orientation === 'L' ? 'landscape' : 'portrait') + '</span>' +
        '<span class="badge">' + page.dpi + ' dpi</span>' +
        (page.exact ? '' : '<span class="badge badge--warn">3 markers</span>');
      body.appendChild(title);
      body.appendChild(meta);

      var tools = document.createElement('div');
      tools.className = 'pagecard__tools';
      tools.innerHTML =
        '<button type="button" class="iconbtn" data-act="up" aria-label="Move page ' + (index + 1) + ' up"' +
        (index === 0 ? ' disabled' : '') + '>' + PS.icon('up') + '</button>' +
        '<button type="button" class="iconbtn" data-act="down" aria-label="Move page ' + (index + 1) + ' down"' +
        (index === count - 1 ? ' disabled' : '') + '>' + PS.icon('down') + '</button>' +
        '<button type="button" class="iconbtn iconbtn--danger" data-act="remove" aria-label="Remove page ' +
        (index + 1) + '">' + PS.icon('trash') + '</button>';

      li.appendChild(thumb);
      li.appendChild(body);
      li.appendChild(tools);
      list.appendChild(li);
    });
  }

  function move(from, to) {
    if (to < 0 || to >= scan.pages.length || from === to) return;
    var moved = scan.pages.splice(from, 1)[0];
    scan.pages.splice(to, 0, moved);
    renderPages();
  }

  function buildScanPaperSegments() {
    $('scan-paper-segments').innerHTML = PS.PAPER_ORDER.map(function (code) {
      return '<button type="button" class="segment' + (code === scan.paper ? ' is-active' : '') +
        '" data-scan-paper="' + code + '" aria-pressed="' + (code === scan.paper) + '">' +
        PS.PAPER[code].label + '</button>';
    }).join('');
  }

  function initScan() {
    var dragFrom = null;

    buildScanPaperSegments();
    $('scan-paper-segments').addEventListener('click', function (event) {
      var button = event.target.closest('[data-scan-paper]');
      if (!button) return;
      scan.paper = button.getAttribute('data-scan-paper');
      Array.prototype.forEach.call(this.children, function (child) {
        var on = child === button;
        child.classList.toggle('is-active', on);
        child.setAttribute('aria-pressed', String(on));
      });
    });

    $('pagelist').addEventListener('click', function (event) {
      var button = event.target.closest('[data-act]');
      if (!button) return;
      var index = parseInt(button.closest('.pagecard').dataset.index, 10);
      var act = button.getAttribute('data-act');
      if (act === 'remove') { scan.pages.splice(index, 1); renderPages(); }
      else if (act === 'up') move(index, index - 1);
      else move(index, index + 1);
    });

    $('pagelist').addEventListener('dragstart', function (event) {
      var card = event.target.closest('.pagecard');
      if (!card) return;
      dragFrom = parseInt(card.dataset.index, 10);
      card.classList.add('is-dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(dragFrom));
    });
    $('pagelist').addEventListener('dragover', function (event) {
      var card = event.target.closest('.pagecard');
      if (!card || dragFrom === null) return;
      event.preventDefault();
      Array.prototype.forEach.call(this.children, function (c) { c.classList.remove('is-drop-target'); });
      card.classList.add('is-drop-target');
    });
    $('pagelist').addEventListener('drop', function (event) {
      var card = event.target.closest('.pagecard');
      if (!card || dragFrom === null) return;
      event.preventDefault();
      move(dragFrom, parseInt(card.dataset.index, 10));
      dragFrom = null;
    });
    $('pagelist').addEventListener('dragend', function () {
      dragFrom = null;
      Array.prototype.forEach.call(this.children, function (c) {
        c.classList.remove('is-dragging', 'is-drop-target');
      });
    });

    /* ---- source switch ---- */
    $('source-segments').addEventListener('click', function (event) {
      var button = event.target.closest('[data-source]');
      if (!button) return;
      var source = button.getAttribute('data-source');
      Array.prototype.forEach.call(this.children, function (c) {
        c.classList.toggle('is-active', c === button);
      });
      $('source-upload').classList.toggle('is-hidden', source !== 'upload');
      $('source-camera').classList.toggle('is-hidden', source !== 'camera');
      if (source !== 'camera') stopCamera();
    });

    /* ---- files ---- */
    var zone = $('dropzone'), input = $('file-input');
    $('dropzone-icon').innerHTML = PS.icon('upload');
    $('empty-icon').innerHTML = PS.icon('files');

    zone.addEventListener('click', function () { input.click(); });
    zone.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.click(); }
    });
    input.addEventListener('change', function () { addFiles(this.files); this.value = ''; });

    ['dragenter', 'dragover'].forEach(function (type) {
      zone.addEventListener(type, function (event) { event.preventDefault(); zone.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (type) {
      zone.addEventListener(type, function (event) { event.preventDefault(); zone.classList.remove('is-over'); });
    });
    zone.addEventListener('drop', function (event) {
      if (event.dataTransfer && event.dataTransfer.files) addFiles(event.dataTransfer.files);
    });

    /* ---- settings ---- */
    $('dpi').addEventListener('input', function () {
      scan.dpi = parseInt(this.value, 10);
      $('dpi-value').textContent = scan.dpi + ' dpi';
    });
    $('strength').addEventListener('input', function () {
      scan.strength = parseInt(this.value, 10);
      $('strength-value').textContent = scan.strength;
    });
    $('hide-markers').addEventListener('change', function () { scan.hideMarkers = this.checked; });

    /* ---- export ---- */
    $('download-scan').addEventListener('click', function () {
      var button = this;
      withBusy(button, '<span>Building PDF…</span>', async function () {
        var blob = await PS.pages.toPDF(scan.pages);
        download(blob, PS.pages.filename(scan.pages));
        log('ok', 'Saved ' + scan.pages.length + ' page' +
          (scan.pages.length === 1 ? '' : 's') + ' as a PDF.');
      });
    });
    $('clear-pages').addEventListener('click', function () {
      scan.pages = [];
      renderPages();
    });

    initCamera();
    renderPages();
  }

  /* =======================================================================
   * Camera
   * ===================================================================== */

  var cam = { stream: null, timer: null, streak: 0, auto: true, working: false };

  function setPips(found) {
    var pips = $('camera-pips').children;
    Array.prototype.forEach.call(pips, function (pip) {
      pip.classList.toggle('is-found', found.indexOf(pip.getAttribute('data-corner')) >= 0);
    });
  }

  function frameToCanvas(video, maxDim) {
    var scale = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight));
    var canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d', { willReadFrequently: true })
      .drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  async function stopCamera() {
    if (cam.timer) { clearInterval(cam.timer); cam.timer = null; }
    if (cam.stream) {
      cam.stream.getTracks().forEach(function (t) { t.stop(); });
      cam.stream = null;
    }
    $('camera-video').srcObject = null;
    $('camera-toggle').textContent = 'Start camera';
    $('camera-shoot').disabled = true;
    $('camera-status').textContent = 'Camera off';
    setPips([]);
  }

  async function captureFromCamera() {
    if (cam.working || scan.busy) return;
    cam.working = true;
    scan.busy = true;
    var video = $('camera-video');
    try {
      var canvas = frameToCanvas(video, MAX_SOURCE_DIM);
      var stamp = new Date().toLocaleTimeString();
      await addCapture(canvas, 'Camera ' + stamp);
    } finally {
      cam.working = false;
      scan.busy = false;
      cam.streak = 0;
    }
  }

  /* Live preview detection runs on a small frame with a tight budget: it only
   * needs to say which corners are visible, not rectify anything. */
  async function pollCamera() {
    var video = $('camera-video');
    if (!cam.stream || cam.working || scan.busy || !video.videoWidth) return;
    cam.working = true;
    try {
      var canvas = frameToCanvas(video, 1100);
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      var detection = PS.scanner.detect(img, { paper: scan.paper, budgetMs: 700 });
      setPips(detection.found);

      if (detection.found.length === 4) {
        cam.streak++;
        $('camera-status').textContent = cam.auto
          ? 'All four corners — holding steady…'
          : 'All four corners found. Ready to capture.';
      } else {
        cam.streak = 0;
        $('camera-status').textContent = detection.found.length
          ? detection.found.length + ' of 4 corners — fit the whole sheet in frame'
          : 'Looking for corner markers…';
      }
      $('camera-shoot').disabled = detection.found.length < 3;
    } finally {
      cam.working = false;
    }

    /* Two consecutive full reads means the shot is steady, not a lucky frame. */
    if (cam.auto && cam.streak >= 2) await captureFromCamera();
  }

  function initCamera() {
    $('camera-auto').addEventListener('change', function () { cam.auto = this.checked; });
    $('camera-shoot').addEventListener('click', captureFromCamera);

    $('camera-toggle').addEventListener('click', async function () {
      if (cam.stream) { stopCamera(); return; }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        log('error', 'This browser will not open a camera here. Camera capture needs ' +
          'an https:// or localhost address — use Files instead.');
        return;
      }
      $('camera-status').textContent = 'Requesting camera…';
      try {
        cam.stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 3840 }, height: { ideal: 2160 }
          },
          audio: false
        });
        var video = $('camera-video');
        video.srcObject = cam.stream;
        await video.play();
        $('camera-toggle').textContent = 'Stop camera';
        $('camera-status').textContent = 'Looking for corner markers…';
        cam.timer = setInterval(pollCamera, 900);
      } catch (err) {
        cam.stream = null;
        $('camera-status').textContent = 'Camera unavailable';
        log('error', 'Could not open the camera: ' + (err && err.message ? err.message : err) +
          '. Camera capture needs an https:// or localhost address.');
      }
    });
  }

  /* =======================================================================
   * Shell
   * ===================================================================== */

  function initModes() {
    document.querySelector('.modes').addEventListener('click', function (event) {
      var button = event.target.closest('[data-mode]');
      if (!button) return;
      var mode = button.getAttribute('data-mode');
      Array.prototype.forEach.call(this.children, function (c) {
        var on = c === button;
        c.classList.toggle('is-active', on);
        c.setAttribute('aria-selected', String(on));
      });
      $('view-generate').classList.toggle('is-hidden', mode !== 'generate');
      $('view-scan').classList.toggle('is-hidden', mode !== 'scan');
      if (mode !== 'scan') stopCamera();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initModes();
    initGenerate();
    initScan();
  });
})(window.PS);
