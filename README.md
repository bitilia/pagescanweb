# PageScan

Generate printable sheets — lined, squared, graph, dot grid, blank, Cornell, music —
with an L-shaped registration mark in each corner. Print them, write on them,
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

Each sheet carries four thick registration marks hugging the page edges: an
**L** at three corners and a **T** at the fourth. The arms sit in the margin;
the open diagonal is left for writing.

```
  ████████              ████████
  ██                          ██
  ██                          ██
  ██                          ██


  ██                          ██
  ██                     ████████
  ██                          ██
  ████████         ████████████████
```

They carry **no payload**. That is the whole point: a data-carrying symbol needs
fine modules that survive poorly in a hand-held photograph. A 2.2mm stroke is
coarse enough to read through blur and grain, and because the mark is only two
(or three) arms rather than a filled square, the keep-out is a thin strip along
each edge instead of a block into the content.

What the markers no longer say, the geometry has to supply:

| | |
|---|---|
| **which corner is which** | The T is printed at one corner only. Find it and the sheet's rotation is fixed; the other three follow from the winding order, which a photograph preserves because paper cannot be mirrored. |
| **orientation** | Compare a horizontal marker span with a vertical one. Any three of the four give one of each. |
| **paper size** | Cannot be recovered. A3, A4 and A5 are the same shape, and nothing in a photograph gives absolute scale. **You tell the scan view which paper you printed on**; it defaults to A4. |

### The fiducial

The one point per marker whose position is known exactly is its **inner crook**
— where the two inner edges meet. It is recovered by averaging every scan that
hit the junction, which puts it well inside a pixel, and unlike a free corner
it does not drift when the stroke blurs.

Every mark's outer face sits 5mm from the page edge, so the four crooks form a
rectangle inset 7.2mm on all sides, whatever the paper size.

Four known points and four measured points give a **homography**: the full
projective map from page millimetres to photo pixels. That is what lets a photo
taken at an angle come back square — it corrects real perspective, not just
rotation. If only three markers are readable the scanner falls back to an affine
fit, which is exact for a flatbed scan and approximate for an angled photo; pages
that took this path are labelled *3 markers* in the capture list.

Because the T names the bottom-right corner, a sheet photographed upside down
or turned sideways rectifies correctly with no user input.

### Generating

Sheets are emitted as **PDFs, not printed from HTML**. Browser printing applies
its own scaling — "fit to page" and unpredictable margins — which would corrupt
the millimetre geometry the whole system depends on. A PDF with an exact
`MediaBox` prints at true size.

One abstract draw-op list feeds both the on-screen SVG preview and the PDF
content stream, so the preview cannot drift from what you get. Rules are clipped
out of a keep-out box around each arm, which keeps its quiet zone clear without
blanking the open corner.

> Print at **100% / actual size**. If your print dialogue offers "fit to page",
> turn it off.

### Scanning

1. **Detect.** Shrink the frame until a 2.2mm stroke is still a few pixels
   across, threshold it locally, then walk the frame looking for L-crooks: two
   long dark runs along neighbouring axes (the arms) and short runs through the
   stroke toward the page edge. A T is the same crook with ink in the open
   diagonal (the stem block). Hits that cluster on the same spot are averaged
   into a sub-pixel crook. The four that best describe a sheet are then re-read
   from tight full-resolution crops. No external decoder is involved:
   `src/finder.js` stays small.
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
   the printed rules when ink pickup is low.

   Then a despeckle pass drops ink blobs smaller than about a third of a
   millimetre, a hairline of page-edge trim removes the shadow every
   photographed sheet has, and the markers themselves are erased.
4. **Export.** Each page becomes an 8-bit greyscale Flate-compressed image at its
   own true page size, so a document can mix A4 and A5 and every sheet comes out
   right. Pages are overwhelmingly pure white, which Flate reduces to almost
   nothing: a written A4 sheet at 200dpi lands around 25KB.

Printed rules are dark enough to survive ordinary inkjet printing and still
show up at the default **Ink pickup** setting. Lower the slider if you want a
scan that keeps only what you wrote and washes the guides away; raise it to
catch faint pencil.

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
- A mark wants roughly **20 pixels along each arm**, so on A4 all four markers
  survive down to a capture of about **420 pixels on the long side**; three
  survive to about 300 (the T's stem, being the extra cue, goes soft first).
  Larger paper needs proportionally more.
- Paper size is not in the markers. Scanning an A5 sheet with the control set to
  A4 gives a correctly squared page at the wrong physical size.

---

## Layout

```
index.html          markup
styles.css          flat design system
src/core.js         paper sizes and marker geometry — shared by both halves
src/templates.js    page rulings as draw ops
src/marker.js       L/T marks as vector rects
src/render.js       draw ops -> SVG preview / PDF content
src/generator.js    sheet composition and export
src/pdf.js          minimal PDF 1.4 writer
src/geom.js         homography, perspective warp, flat-field, tone map, despeckle
src/finder.js       L/T crook search
src/scanner.js      marker detection and rectification
src/pages.js        capture store, thumbnails, scanned-document PDF
src/icons.js        inline Lucide glyphs
src/app.js          interface
vendor/             Outfit — self-hosted
test/               round-trip geometry suite and a Chromium end-to-end suite
```

`src/core.js` is the single source of truth for paper sizes, stroke width and
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
