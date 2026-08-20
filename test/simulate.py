"""Turn a generated sheet PDF into a plausible camera photo.

Renders the page, stamps synthetic ink at exact millimetre coordinates,
then applies a projective warp, a lighting gradient, blur and sensor noise.
The known ink positions are what the round-trip test measures against.
"""
import json, sys, math
import numpy as np
import pymupdf

MM_PER_IN = 25.4

def render(pdf_path, dpi):
    doc = pymupdf.open(pdf_path)
    page = doc[0]
    pix = page.get_pixmap(dpi=dpi, colorspace=pymupdf.csRGB)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
    return img.astype(np.float32).copy()

def stamp(img, marks, dpi):
    """Draw filled discs at page-mm positions; these stand in for pen strokes.

    A fourth element sets the grey level, so a mark can be pencil rather than
    ink; it defaults to near-black."""
    ppm = dpi / MM_PER_IN
    h, w = img.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    for mark in marks:
        mx, my, r_mm = mark[0], mark[1], mark[2]
        level = mark[3] if len(mark) > 3 else 20.0
        cx, cy, r = mx * ppm, my * ppm, r_mm * ppm
        img[(xx - cx) ** 2 + (yy - cy) ** 2 <= r * r] = float(level)
    return img

def homography(src, dst):
    A, b = [], []
    for (x, y), (u, v) in zip(src, dst):
        A.append([x, y, 1, 0, 0, 0, -x * u, -y * u]); b.append(u)
        A.append([0, 0, 0, x, y, 1, -x * v, -y * v]); b.append(v)
    h = np.linalg.solve(np.array(A, float), np.array(b, float))
    return np.array([[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1.0]])

def warp(img, quad, out_w, out_h):
    """Map the page rectangle onto `quad` in an out_w x out_h frame."""
    h, w = img.shape[:2]
    src = [(0, 0), (w, 0), (w, h), (0, h)]
    H_inv = homography(quad, src)           # output px -> source px
    ys, xs = np.mgrid[0:out_h, 0:out_w].astype(np.float64)
    den = H_inv[2, 0] * xs + H_inv[2, 1] * ys + H_inv[2, 2]
    u = (H_inv[0, 0] * xs + H_inv[0, 1] * ys + H_inv[0, 2]) / den
    v = (H_inv[1, 0] * xs + H_inv[1, 1] * ys + H_inv[1, 2]) / den
    inside = (u >= 0) & (u <= w - 1.01) & (v >= 0) & (v <= h - 1.01)
    u0 = np.clip(u.astype(np.int32), 0, w - 2); v0 = np.clip(v.astype(np.int32), 0, h - 2)
    fu = np.clip(u - u0, 0, 1)[..., None]; fv = np.clip(v - v0, 0, 1)[..., None]
    top = img[v0, u0] * (1 - fu) + img[v0, u0 + 1] * fu
    bot = img[v0 + 1, u0] * (1 - fu) + img[v0 + 1, u0 + 1] * fu
    out = top * (1 - fv) + bot * fv
    out[~inside] = 90.0                      # dark desk around the sheet
    return out

def box_blur(img, r):
    if r < 1: return img
    k = 2 * r + 1
    pad = np.pad(img, ((r, r), (r, r), (0, 0)), mode='edge')
    c = np.cumsum(np.cumsum(pad, axis=0), axis=1)
    c = np.pad(c, ((1, 0), (1, 0), (0, 0)))
    h, w = img.shape[:2]
    return (c[k:k + h, k:k + w] - c[0:h, k:k + w] - c[k:k + h, 0:w] + c[0:h, 0:w]) / (k * k)

def main():
    cfg = json.loads(sys.argv[1])
    rng = np.random.default_rng(cfg.get('seed', 7))
    img = render(cfg['pdf'], cfg['dpi'])
    marks = cfg.get('marks', [])
    if marks:
        img = stamp(img, marks, cfg['dpi'])

    ow, oh = cfg['out'][0], cfg['out'][1]
    quad = cfg['quad']
    img = warp(img, quad, ow, oh)

    if cfg.get('blur', 0):
        img = box_blur(img, cfg['blur'])
    if cfg.get('light', True):
        ys, xs = np.mgrid[0:oh, 0:ow].astype(np.float32)
        grad = 0.62 + 0.38 * np.exp(-(((xs / ow) - 0.28) ** 2 + ((ys / oh) - 0.2) ** 2) / 0.30)
        img *= grad[..., None]
    if cfg.get('noise', 0):
        img += rng.normal(0, cfg['noise'], img.shape)

    img = np.clip(img, 0, 255).astype(np.uint8)
    if cfg.get('raw'):
        rgba = np.dstack([img, np.full((oh, ow, 1), 255, np.uint8)])
        rgba.tofile(cfg['raw'])
    if cfg.get('png'):
        pix = pymupdf.Pixmap(pymupdf.csRGB, ow, oh, bytearray(img.tobytes()), False)
        pix.save(cfg['png'])
    print(json.dumps({'width': ow, 'height': oh}))

main()
