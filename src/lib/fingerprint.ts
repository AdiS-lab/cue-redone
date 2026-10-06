// A tiny fingerprint of a photo, for "I just pointed at this" cache hits.
//   gray:   32x24 grayscale thumbnail of the central 80 % (block-averaged, so no aliasing).
//           Two photos are compared by normalised cross-correlation at the best of ±3 px shifts
//           (about ±10 % of the frame), so a hand that moved a little still matches,
//           and brightness/contrast changes cancel out.
//   colour: mean RGB of a 2x2 grid, so a red box and a blue box with the same shape don't match.
// It recognises the *same view*, not the same object from a new angle; the model handles that via the notebook.
//
// A plain 64-bit dHash was tried first: a 3 % shift flipped up to 23 bits, as many as separated
// different test images, so it could not tell a re-point from a new object (scripts/e2e.mjs measures both).

export interface Fingerprint {
  /** 32x24 grayscale, base64 of the bytes. */
  gray: string;
  /** 12 numbers 0-255: [r,g,b] for each quadrant (TL, TR, BL, BR). */
  colour: number[];
}

export const GW = 32;
export const GH = 24;
export const MAX_SHIFT = 3;

export function encodeGray(g: Uint8Array): string {
  let s = "";
  for (let i = 0; i < g.length; i++) s += String.fromCharCode(g[i]);
  return btoa(s);
}

export function decodeGray(s: string): Uint8Array {
  const raw = atob(s);
  const g = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) g[i] = raw.charCodeAt(i);
  return g;
}

/** Normalised cross-correlation of two GWxGH images with `b` shifted by (dx, dy), over their overlap. */
export function nccAt(a: ArrayLike<number>, b: ArrayLike<number>, dx: number, dy: number, w = GW, h = GH): number {
  const x0 = Math.max(0, -dx);
  const x1 = Math.min(w, w - dx);
  const y0 = Math.max(0, -dy);
  const y1 = Math.min(h, h - dy);
  let n = 0;
  let sa = 0;
  let sb = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      sa += a[y * w + x];
      sb += b[(y + dy) * w + x + dx];
      n++;
    }
  if (n === 0) return 0;
  const ma = sa / n;
  const mb = sb / n;
  let num = 0;
  let va = 0;
  let vb = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const da = a[y * w + x] - ma;
      const db = b[(y + dy) * w + x + dx] - mb;
      num += da * db;
      va += da * da;
      vb += db * db;
    }
  // two flat images (a wall, darkness) correlate perfectly only if they're the same flat level
  if (va < 1e-6 || vb < 1e-6) return va < 1e-6 && vb < 1e-6 && Math.abs(ma - mb) < 8 ? 1 : 0;
  return num / Math.sqrt(va * vb);
}

/** Best correlation over shifts of up to ±maxShift pixels. 1 = identical. */
export function alignedSimilarity(a: ArrayLike<number>, b: ArrayLike<number>, maxShift = MAX_SHIFT): number {
  let best = -1;
  for (let dy = -maxShift; dy <= maxShift; dy++)
    for (let dx = -maxShift; dx <= maxShift; dx++) best = Math.max(best, nccAt(a, b, dx, dy));
  return best;
}

/** Mean absolute difference of the colour signatures, 0-255. */
export function colourDistance(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 255;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

export interface MatchThresholds {
  /** Minimum aligned correlation (−1..1). */
  ncc: number;
  /** Max mean colour difference (0-255). */
  colour: number;
}

// Measured by scripts/e2e.mjs on test-images/ (3 % shift + 10 % brighter vs. every other image).
export const DEFAULT_MATCH: MatchThresholds = { ncc: 0.9, colour: 28 };

export function similarity(a: Fingerprint, b: Fingerprint): number {
  return alignedSimilarity(decodeGray(a.gray), decodeGray(b.gray));
}

export function sameView(a: Fingerprint, b: Fingerprint, t: MatchThresholds = DEFAULT_MATCH): boolean {
  if (colourDistance(a.colour, b.colour) > t.colour) return false;
  return similarity(a, b) >= t.ncc;
}

type Drawable = CanvasImageSource & { width: number; height: number };

let scratch: OffscreenCanvas | null = null;
const OVER = 4;

/** Fingerprint of the central 80 % of an image (the ring points at the middle). */
export function fingerprint(image: Drawable): Fingerprint {
  const W = GW * OVER;
  const H = GH * OVER;
  scratch ??= new OffscreenCanvas(W, H);
  const ctx = scratch.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, image.width * 0.1, image.height * 0.1, image.width * 0.8, image.height * 0.8, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;
  const sums = new Float64Array(GW * GH * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const c = (Math.floor(y / OVER) * GW + Math.floor(x / OVER)) * 3;
      sums[c] += px[i];
      sums[c + 1] += px[i + 1];
      sums[c + 2] += px[i + 2];
    }
  const n = OVER * OVER;
  const gray = new Uint8Array(GW * GH);
  for (let i = 0; i < gray.length; i++) gray[i] = Math.round((0.299 * sums[i * 3] + 0.587 * sums[i * 3 + 1] + 0.114 * sums[i * 3 + 2]) / n);
  const colour: number[] = [];
  for (const [qx, qy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const acc = [0, 0, 0];
    let k = 0;
    for (let y = qy * (GH / 2); y < (qy + 1) * (GH / 2); y++)
      for (let x = qx * (GW / 2); x < (qx + 1) * (GW / 2); x++) {
        const c = (y * GW + x) * 3;
        acc[0] += sums[c];
        acc[1] += sums[c + 1];
        acc[2] += sums[c + 2];
        k++;
      }
    colour.push(...acc.map((v) => Math.round(v / (k * n))));
  }
  return { gray: encodeGray(gray), colour };
}
