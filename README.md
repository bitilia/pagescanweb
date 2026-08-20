# PageScan

Generate printable sheets — lined, squared, graph, dot grid, blank, Cornell, music —
with a QR marker in each corner. Print them, write on them, photograph or scan them,
and get back a PDF that is square, cropped and cleaned.

No backend, no build step, no dependencies. HTML, CSS and JavaScript that run
straight from a `file://` path.

```
open index.html          # or double-click it
```

Camera capture is the one exception: browsers only expose a camera on `https://`
or `localhost`, so for that run a static server first:

```
python3 -m http.server 8000     # then visit http://localhost:8000
```

Everything else — importing photos, rectifying, exporting PDFs — works offline
from a plain file path.

---

## How it works

### The markers

Each sheet carries four QR symbols, one per corner:

```
PS1:A4:P:TL
 │   │  │  └── which corner: TL, TR, BR, BL
 │   │  └───── orientation:  P portrait, L landscape
 │   └──────── paper:        A3 A4 A5 LT (Letter) LG (Legal)
 └──────────── format version
```

Eleven characters, all inside QR *alphanumeric* mode, which keeps the symbol at
version 2 — 25×25 modules — even at error-correction level H. Printed at 15mm,
that is 0.6mm per module, so a 15mm marker survives being photographed small.

The payload is deliberately geometry-only. It says what the sheet is and which
corner you are looking at; it carries no document identity, so pages are ordered
by hand in the scan view.

### The fiducial

The one point per marker whose position is known exactly is its **outward-facing
corner** — top-left of the TL symbol, top-right of the TR symbol, and so on.
Every marker sits 6mm from the page edge, so those four points form a rectangle
inset 6mm on all sides, whatever the paper size.

Four known points and four measured points give a **homography**: the full
projective map from page millimetres to photo pixels. That is what lets a photo
taken at an angle come back square — it corrects real perspective, not just
rotation. If only three markers are readable the scanner falls back to an affine
fit, which is exact for a flatbed scan and approximate for an angled photo; pages
that took this path are labelled *3 markers* in the capture list.

Because each marker names the orientation and its own corner, a sheet
photographed upside down or turned sideways rectifies correctly with no user
input.

### Generating

Sheets are emitted as **PDFs, not printed from HTML**. Browser printing applies
its own scaling — "fit to page" and unpredictable margins — which would corrupt
the millimetre geometry the whole system depends on. A PDF with an exact
`MediaBox` prints at true size.

One abstract draw-op list feeds both the on-screen SVG preview and the PDF
content stream, so the preview cannot drift from what you get. Rules are clipped
out of a keep-out box around each marker, which keeps the QR quiet zones clear.

> Print at **100% / actual size**. If your print dialogue offers "fit to page",
> turn it off.

### Scanning

1. **Detect.** jsQR reads one symbol per call, and a page photo can be 12
   megapixels, so detection is staged. It sweeps four overlapping quadrants at a
   resolution where a 15mm marker still spans about 4 pixels per module; once two
   markers are known the page's pose is roughly determined, so the remaining
   corners are *predicted* and read from small native-resolution windows rather
   than hunted for. Every hit is finally re-read from a tight full-resolution
   crop, so the fiducials carry full precision whichever pass found them.
   The whole search is bounded by a time budget.
2. **Rectify.** Warp from photo pixels onto a page-millimetre lattice. Output
   resolution is capped at what the source actually resolved — upsampling past
   that only inflates the file.
3. **Clean.** Sauvola local thresholding, which keys off local standard
   deviation rather than a flat offset, so blank paper under uneven lighting
   stays blank instead of breaking into speckle. Then a despeckle pass drops ink
   blobs smaller than about a third of a millimetre, a hairline of page-edge trim
   removes the shadow every photographed sheet has, and the markers themselves
   are erased.
4. **Export.** Each page becomes a 1-bit Flate-compressed image at its own true
   page size, so a document can mix A4 and A5 and every sheet comes out right.

Printed rules are pale by design — they sit just above the default ink threshold,
so a scan contains what you wrote rather than the paper you wrote it on. Raise
**Ink pickup** to bring the rules back (useful for a curve plotted on graph
paper) or to catch faint pencil.

---

## Accuracy

`test/roundtrip.js` generates real sheet PDFs, renders them, stamps synthetic ink
at exact millimetre coordinates, distorts the result into a plausible photograph
(perspective, lighting gradient, blur, sensor noise) and then measures where that
ink lands after a full detect-and-rectify cycle.

| capture | markers | worst ink error |
|---|---|---|
| A4 portrait, flat | 4/4 | 0.14 mm |
| A4 portrait, moderate angle | 4/4 | 0.14 mm |
| A4 portrait, steep angle | 4/4 | 0.17 mm |
| A4 portrait, upside down | 4/4 | 0.07 mm |
| A4 landscape | 4/4 | 0.27 mm |
| A5 portrait / landscape | 4/4 | 0.14 mm |
| Letter portrait | 4/4 | 0.16 mm |
| Legal portrait | 4/4 | 0.20 mm |
| A3 landscape | 4/4 | 0.20 mm |
| A4, dim and grainy | 4/4 | 0.12 mm |
| A4, small capture | 4/4 | 0.26 mm |
| A4 flatbed, one corner clipped | 3/4 (affine) | 0.33 mm |

Printed rules return to their stated positions within 0.16mm, and markers in a
generated PDF sit within 0.069mm of spec when re-read from a 300dpi render.

### Where it stops working

Measured on a 2000×2700 capture of A4 (a modest phone photo):

- Blur up to a 5×5 box and sensor noise to about σ=11 still read all four
  markers. A 7×7 blur, or noise past roughly σ=18, does not.
- The whole sheet must be in frame. Markers cut off by the frame edge cannot be
  read, and fewer than three leaves nothing to rectify from.
- A marker needs roughly 3 pixels per module in the source, so a 15mm marker
  wants about 75 pixels across. On A4 that means a capture of at least
  ~1100 pixels on the long side; larger paper needs proportionally more.

---

## Layout

```
index.html          markup
styles.css          flat design system
src/core.js         paper sizes, marker geometry, payload codec — shared by both halves
src/templates.js    page rulings as draw ops
src/marker.js       QR matrices, merged into vector runs
src/render.js       draw ops -> SVG preview / PDF content
src/generator.js    sheet composition and export
src/pdf.js          minimal PDF 1.4 writer
src/geom.js         homography, perspective warp, Sauvola, despeckle
src/scanner.js      marker detection and rectification
src/pages.js        capture store, thumbnails, scanned-document PDF
src/icons.js        inline Lucide glyphs
src/app.js          interface
vendor/             jsQR, qrcode-generator, Outfit — all self-hosted
test/               round-trip geometry suite and a Chromium end-to-end suite
```

`src/core.js` is the single source of truth for paper sizes, marker placement and
the payload format. The printed sheet and the scanner both read from it, so the
two halves cannot drift apart.

## Tests

```
npm install          # playwright, for the browser suite only
npm test
```

The geometry suite additionally needs `python3` with `numpy` and `pymupdf`, which
it uses to render generated PDFs and synthesise camera photographs.

## Third-party

| | |
|---|---|
| [jsQR](https://github.com/cozmo/jsQR) | Apache-2.0 — QR decoding |
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) | MIT — QR encoding |
| [Outfit](https://github.com/Outfitio/Outfit-Fonts) | SIL OFL 1.1 — typeface |

Licences are kept alongside the files in `vendor/`; qrcode-generator carries its
MIT notice in the header of `vendor/qrcode.js`.
