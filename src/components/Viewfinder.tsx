// Shows what the ring sees and takes the picture for a press.
//   Stream sources (webcam, Wi-Fi stream): keeps the last frames and picks the sharpest one from just before the press.
//   Still sources (the ring, Bluetooth, files): asks for a burst on press and keeps the sharpest.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { IDENTITY, captureFrames, orientFrame, withTimeout, type FrameSource, type Orientation, type StatusInfo } from "../vision/sources";
import { FrameBuffer } from "../vision/core/frameBuffer";
import { rankFrames, sharpness } from "../vision/core/sharpness";

export interface Shot {
  image: HTMLCanvasElement;
  sharpness: number;
  /** Press to picture, ms. */
  ms: number;
  frames: number;
}

export interface ViewfinderHandle {
  capture(): Promise<Shot | null>;
}

interface Props {
  source: FrameSource;
  status: StatusInfo;
  orientation?: Orientation;
  mirror?: boolean;
  burst?: number;
  discard?: number;
  delayMs?: number;
  /** Text over the picture (e.g. "Looking…"). */
  overlay?: string | null;
}

const STILL_TIMEOUT_MS = 10_000;
const FREEZE_MS = 1200;
/** A stream that has sent nothing for this long is stalled; its buffered frames are stale. */
const STALE_MS = 1500;

function snapshot(frame: CanvasImageSource & { width: number; height: number }): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = frame.width;
  c.height = frame.height;
  c.getContext("2d")!.drawImage(frame, 0, 0);
  return c;
}

const STATUS_TEXT: Record<StatusInfo["status"], string> = {
  idle: "Camera off",
  connecting: "Connecting to camera…",
  live: "",
  reconnecting: "Reconnecting…",
  error: "Camera error",
};

export const Viewfinder = forwardRef<ViewfinderHandle, Props>(function Viewfinder(
  { source, status, orientation = IDENTITY, mirror = false, burst = 3, discard = 1, delayMs = 0, overlay = null },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bufferRef = useRef(new FrameBuffer(10));
  const latestRef = useRef<ImageBitmap | null>(null);
  const lastFrameAtRef = useRef(0);
  const frozenRef = useRef<{ image: HTMLCanvasElement; until: number } | null>(null);
  const dirtyRef = useRef(false);
  const orientationRef = useRef(orientation);
  orientationRef.current = orientation;
  const [hasPicture, setHasPicture] = useState(false);
  const [aspect, setAspect] = useState("4 / 3");
  const stream = source.mode === "stream";

  const paint = (img: CanvasImageSource & { width: number; height: number }) => {
    const c = canvasRef.current;
    if (!c) return;
    if (c.width !== img.width || c.height !== img.height) {
      c.width = img.width;
      c.height = img.height;
      setAspect(`${img.width} / ${img.height}`);
    }
    c.getContext("2d")!.drawImage(img, 0, 0);
    setHasPicture(true);
  };

  useEffect(() => {
    const buffer = bufferRef.current;
    buffer.clear();
    latestRef.current = null;
    frozenRef.current = null;
    setHasPicture(false);
    if (!source.onFrame || source.mode !== "stream") return;
    source.onFrame((bmp, time) => {
      const up = orientFrame(bmp, orientationRef.current);
      buffer.push(up, time);
      latestRef.current = up;
      lastFrameAtRef.current = performance.now();
      dirtyRef.current = true;
    });
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const frozen = frozenRef.current;
      if (frozen && performance.now() < frozen.until) return;
      if (frozen) {
        frozenRef.current = null;
        dirtyRef.current = true;
      }
      if (!dirtyRef.current || !latestRef.current) return;
      dirtyRef.current = false;
      try {
        paint(latestRef.current);
      } catch {
        // the bitmap was closed by the buffer between frames; the next one will do
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      source.onFrame?.(null);
      buffer.clear();
      latestRef.current = null;
    };
  }, [source]);

  const captureStream = (): Shot | null => {
    const t0 = performance.now();
    if (t0 - lastFrameAtRef.current > STALE_MS) return null;
    const sel = bufferRef.current.select(t0);
    if (!sel) return null;
    const image = snapshot(sel.frame.image);
    frozenRef.current = { image, until: t0 + FREEZE_MS };
    paint(image);
    return { image, sharpness: sel.frame.sharpness ?? sharpness(image), ms: performance.now() - t0, frames: sel.candidates };
  };

  const captureStill = async (): Promise<Shot | null> => {
    if (!source.capture) return null;
    const t0 = performance.now();
    const shot = await withTimeout(captureFrames(source, { count: burst, discard, delayMs }), STILL_TIMEOUT_MS + delayMs);
    const ranked = rankFrames(
      shot.frames.map((f) => {
        const item = orientFrame(f, orientationRef.current);
        return { item, sharpness: sharpness(item) };
      })
    );
    const best = ranked[0];
    const image = snapshot(best.item);
    ranked.forEach((r) => r.item.close());
    frozenRef.current = { image, until: Number.POSITIVE_INFINITY };
    paint(image);
    return { image, sharpness: best.sharpness, ms: performance.now() - t0, frames: shot.received };
  };

  useImperativeHandle(ref, () => ({
    capture: async () => {
      if (stream) {
        const shot = captureStream();
        if (shot) return shot;
        // a stream source that hasn't sent frames yet may still take stills
      }
      return captureStill();
    },
  }));

  const message = STATUS_TEXT[status.status] || (!hasPicture ? (stream ? "Waiting for the camera…" : "Press the ring to look") : "");

  return (
    <div className="relative w-full overflow-hidden rounded-2xl bg-stone-900" style={{ aspectRatio: aspect }} data-testid="viewfinder">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full object-contain" style={mirror ? { transform: "scaleX(-1)" } : undefined} />
      {message && (
        <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-stone-300">
          {message}
          {status.message ? <span className="block text-xs text-stone-400">{status.message}</span> : null}
        </div>
      )}
      {overlay && (
        <div className="absolute bottom-3 left-3 rounded-full bg-black/60 px-3 py-1 text-sm font-medium text-white" data-testid="overlay">
          {overlay}
        </div>
      )}
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/50" />
    </div>
  );
});
