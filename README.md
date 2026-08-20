# PageScan

Generate printable sheets — lined, squared, graph, dot grid, blank, Cornell, music —
with a QR-style registration marker in each corner. Print them, write on them,
photograph or scan them, and get back a PDF that is square, cropped and cleaned.

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

Each sheet carries the four registration patterns a QR code wears in its own
corners, printed on their own:

```
  ███████         ███████
  █     █         █     █          three 7-module finder squares
  █ ███ █         █ ███ █          at TL, TR and BL
  █ ███ █         █ ███ █
  █ ███ █         █ ███ █
  █     █         █     █
  ███████         ███████


  ███████          █████
  █     █          █   █           and the 5-module alignment
  █ ███ █          █ █ █           square alone at BR
  █ ███ █          █   █
  █ ███ █          █████
  █     █
  ███████
```

They carry **no payload**. That is the whole point: a symbol that encodes
`PS1:A4:P:TL` needs 25×25 modules, which at a 15mm marker is 0.6mm per module —
fine on a flatbed, marginal in a hand-held photograph. A finder square is seven
modules across, so the same ink buys **2.2mm modules**, three and a half times
coarser, and the pattern survives blur and grain that would destroy a data
symbol.

What the markers no longer say, the geometry has to supply:

| | |
|---|---|
| **which corner is which** | The alignment square is printed at one corner only. Find it and the sheet's rotation is fixed; the other three follow from the winding order, which a photograph preserves because paper cannot be mirrored. This is the same trick a QR code plays with its three eyes. |
| **orientation** | Compare a horizontal marker span with a vertical one. Any three of the four give one of each. |
| **paper size** | Cannot be recovered. A3, A4 and A5 are the same shape, and nothing in a photograph gives absolute scale. **You tell the scan view which paper you printed on**; it defaults to A4. |

### The fiducial

The one point per marker whose position is known exactly is its **centre**. It is
recovered by averaging every scan line that crossed the pattern — thirty-odd in
each axis — which puts it well inside a pixel, and unlike a corner it does not
drift when the symbol blurs.

Every finder square's outer edge sits 6mm from the page edge, so the four centres
form a rectangle inset 13.7mm on all sides, whatever the paper size.

Four known points and four measured points give a **homography**: the full
projective map from page millimetres to photo pixels. That is what lets a photo
taken at an angle come back square — it corrects real perspective, not just
rotation. If only three markers are readable the scanner falls back to an affine
fit, which is exact for a flatbed scan and approximate for an angled photo; pages
that took this path are labelled *3 markers* in the capture list.

Because the alignment square names the bottom-right corner, a sheet photographed
upside down or turned sideways rectifies correctly with no user input.

### Generating

Sheets are emitted as **PDFs, not printed from HTML**. Browser printing applies
its own scaling — "fit to page" and unpredictable margins — which would corrupt
the millimetre geometry the whole system depends on. A PDF with an exact
`MediaBox` prints at true size.

One abstract draw-op list feeds both the on-screen SVG preview and the PDF
content stream, so the preview cannot drift from what you get. Rules are clipped
out of a keep-out box around each marker, which keeps its quiet zone clear.
A whole sheet's markers come to 54 rectangles.

> Print at **100% / actual size**. If your print dialogue offers "fit to page",
> turn it off.

### Scanning

1. **Detect.** Shrink the frame until a 2.2mm module is still a few pixels
   across, threshold it locally, then walk every row and every column looking
   for five consecutive runs of alternating colour in the ratio **1:1:3:1:1**
   (a finder, seen through its core) or **1:1:1:1:1** (an alignment square).
   One line proves nothing — a stave of music or a row of grid dots can hit
   those run lengths by accident — so a spot only counts if rows *and* columns
   agree on it, which anything linear fails by construction. The four that best
   describe a sheet are then re-read from tight full-resolution crops.
   No QR decoder is involved, and none is needed: `src/finder.js` is 135 lines.
2. **Rectify.** Warp from photo pixels onto a page-millimetre lattice. Output
   resolution is capped at what the source actually resolved — upsampling past
   that only inflates the file.
3. **Clean — and it keeps grey.** A photograph of paper has a lighting gradient
   across it, so "white" is a different number in one corner than another. The
   page is flat-fielded first: a high quantile per 4mm block, dilated so a block
   buried under a thick stroke borrows paper from its neighbours, smoothed and
   interpolated back up. Every pixel is then read as a fraction of its own local
   paper level, and that fraction is stretched:

   - at or above the white point → **255, clean white paper**
   - at or below the black point → **0, solid black**
   - in between → **the grey it earned**

   Nothing is thresholded away below the white point, so pencil stays pencil and
   a shaded diagram stays shaded. **Ink pickup** moves the white point (0.62 to
   0.94 of paper): low keeps only confident ink, high brings in faint pencil and
   the pale printed rules.

   Then a despeckle pass drops ink blobs smaller than about a third of a
   millimetre, a hairline of page-edge trim removes the shadow every
   photographed sheet has, and the markers themselves are erased.
4. **Export.** Each page becomes an 8-bit greyscale Flate-compressed image at its
   own true page size, so a document can mix A4 and A5 and every sheet comes out
   right. Pages are overwhelmingly pure white, which Flate reduces to almost
   nothing: a written A4 sheet at 200dpi lands around 25KB.

Printed rules are pale by design — they sit just above the default white point,
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
| A4 portrait, flat | 4/4 | 0.12 mm |
| A4 portrait, moderate angle | 4/4 | 0.15 mm |
| A4 portrait, steep angle | 4/4 | 0.14 mm |
| A4 portrait, upside down | 4/4 | 0.05 mm |
| A4 landscape | 4/4 | 0.15 mm |
| A5 portrait / landscape | 4/4 | 0.13 mm |
| Letter portrait | 4/4 | 0.15 mm |
| Legal portrait | 4/4 | 0.13 mm |
| A3 landscape | 4/4 | 0.17 mm |
| A4, dim and grainy | 4/4 | 0.14 mm |
| A4, small capture | 4/4 | 0.17 mm |
| A4 flatbed, one corner clipped | 3/4 (affine) | 0.16 mm |

Printed rules return to their stated positions within 0.03mm, and markers in a
generated PDF sit within 0.12mm of spec when re-read from a 300dpi render.
Detection takes about 150–250ms on a 2000×2700 frame.

### Where it stops working

Measured on a 2000×2700 capture of A4 (a modest phone photo):

- Blur up to a **25×25 box** still reads all four markers; 29×29 and 33×33 drop
  to three; 41×41 reads none. Sensor noise was still read at **σ=120**, which is
  well past the point where the sheet stops looking like paper.
- The whole sheet must be in frame. A marker cut off by the frame edge cannot be
  read, and fewer than three leaves nothing to rectify from.
- A finder square wants roughly **20 pixels across**, so on A4 all four markers
  survive down to a capture of about **420 pixels on the long side**; three
  survive to about 300 (the alignment square, being smaller, goes first). Larger
  paper needs proportionally more.
- Paper size is not in the markers. Scanning an A5 sheet with the control set to
  A4 gives a correctly squared page at the wrong physical size.

---

## Layout

```
index.html          markup
styles.css          flat design system
src/core.js         paper sizes and marker geometry — shared by both halves
src/templates.js    page rulings as draw ops
src/marker.js       finder/alignment patterns, merged into vector runs
src/render.js       draw ops -> SVG preview / PDF content
src/generator.js    sheet composition and export
src/pdf.js          minimal PDF 1.4 writer
src/geom.js         homography, perspective warp, flat-field, tone map, despeckle
src/finder.js       the 1:1:3:1:1 pattern search
src/scanner.js      marker detection and rectification
src/pages.js        capture store, thumbnails, scanned-document PDF
src/icons.js        inline Lucide glyphs
src/app.js          interface
vendor/             Outfit — self-hosted
test/               round-trip geometry suite and a Chromium end-to-end suite
```

`src/core.js` is the single source of truth for paper sizes, module size and
marker placement. The printed sheet and the scanner both read from it, so the
two halves cannot drift apart.

## Tests

```
npm install          # playwright, for the browser suite only
npm test
```

Both suites need `python3` with `numpy` and `pymupdf`: the geometry suite uses
them to render generated PDFs and synthesise camera photographs, and the browser
suite builds its three input photos the same way (`test/make-fixtures.js`, or
point `PS_FIXTURES` at a directory of your own).

## Third-party

| | |
|---|---|
| [Outfit](https://github.com/Outfitio/Outfit-Fonts) | SIL OFL 1.1 — typeface |

Licences are kept alongside the files in `vendor/`. Nothing else is vendored —
the markers are generated and read by this repository's own code.
