// On-device check before spending a network round trip: is the photo usable at all?
// Uses the burst picker's sharpness (variance of the Laplacian, src/vision/core/sharpness.ts)
// plus mean brightness of a small grayscale copy.
import { downscaledGray, laplacianVariance, centreRegion, type FrameImage } from "../vision/core/sharpness";

export type QualityProblem = "dark" | "blurry";

export interface Quality {
  brightness: number;
  sharpness: number;
  problem: QualityProblem | null;
}

// Lenient on purpose: Claude copes with soft photos, so only stop clearly hopeless ones.
// Eval set (src/vision README): clean photos score > 330, synthetic motion blur ~86.
export const MIN_SHARPNESS = 40;
export const MIN_BRIGHTNESS = 28;

export function judge(brightness: number, sharpness: number): QualityProblem | null {
  if (brightness < MIN_BRIGHTNESS) return "dark";
  if (sharpness < MIN_SHARPNESS) return "blurry";
  return null;
}

export function measure(image: FrameImage): Quality {
  const { gray, w, h } = downscaledGray(image, 160, centreRegion(image.width, image.height));
  let sum = 0;
  for (let i = 0; i < gray.length; i++) sum += gray[i];
  const brightness = sum / gray.length;
  const sharpness = laplacianVariance(gray, w, h);
  return { brightness, sharpness, problem: judge(brightness, sharpness) };
}

export const PROBLEM_TEXT: Record<QualityProblem, string> = {
  dark: "Too dark to see. Try more light.",
  blurry: "Too blurry. Hold still, or pull back a little.",
};
