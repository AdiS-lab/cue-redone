// Photo -> what goes over the wire and into the notebook.
// Claude downscales anything above ~1.15 MP, so sending more than ~1280 px on the long side only costs upload time.
type Drawable = CanvasImageSource & { width: number; height: number };

export const SEND_MAX_SIDE = 1280;
export const THUMB_MAX_SIDE = 192;

function scaled(image: Drawable, maxSide: number): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(image.width * scale));
  c.height = Math.max(1, Math.round(image.height * scale));
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, c.width, c.height);
  return c;
}

/** Base64 JPEG (no data: prefix) at most SEND_MAX_SIDE px on the long side. */
export function jpegBase64(image: Drawable, maxSide = SEND_MAX_SIDE, quality = 0.82): string {
  return scaled(image, maxSide).toDataURL("image/jpeg", quality).replace(/^data:image\/jpeg;base64,/, "");
}

export function thumbnail(image: Drawable): string {
  return scaled(image, THUMB_MAX_SIDE).toDataURL("image/jpeg", 0.7);
}
