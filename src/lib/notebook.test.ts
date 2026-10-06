import { describe, expect, it } from "vitest";
import { GH, GW, alignedSimilarity, colourDistance, decodeGray, encodeGray, nccAt, sameView, type Fingerprint } from "./fingerprint";
import { contextLines, currentPlace, findSameView, sameAnswer, type Entry } from "./notebook";
import { judge } from "./quality";

const NOW = 1_800_000_000_000;

function entry(p: Partial<Entry>): Entry {
  return { id: Math.random().toString(36), at: NOW, mode: "look", headline: "h", detail: "", title: "t", place: "", status: "done", ...p };
}

// deterministic pseudo-random 32x24 texture
function texture(seed: number): Uint8Array {
  const g = new Uint8Array(GW * GH);
  let x = seed;
  for (let i = 0; i < g.length; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    g[i] = x % 256;
  }
  // smooth it a little so it looks like a photo, not noise
  return g.map((v, i) => (v + g[(i + 1) % g.length] + g[(i + GW) % g.length]) / 3);
}

function shifted(g: Uint8Array, dx: number, dy: number): Uint8Array {
  const out = new Uint8Array(g.length);
  for (let y = 0; y < GH; y++)
    for (let x = 0; x < GW; x++) {
      const sx = Math.min(GW - 1, Math.max(0, x - dx));
      const sy = Math.min(GH - 1, Math.max(0, y - dy));
      out[y * GW + x] = g[sy * GW + sx];
    }
  return out;
}

const texA = texture(1);
const fpA: Fingerprint = { gray: encodeGray(texA), colour: Array(12).fill(100) };

describe("fingerprint", () => {
  it("gray round-trips through base64", () => {
    expect(Array.from(decodeGray(encodeGray(texA)))).toEqual(Array.from(texA));
  });

  it("a shifted, brighter copy still correlates; a different texture does not", () => {
    const moved = shifted(texA, 2, -1).map((v) => Math.min(255, v * 1.1 + 5));
    expect(alignedSimilarity(texA, moved)).toBeGreaterThan(0.95);
    expect(nccAt(texA, moved, 0, 0)).toBeLessThan(0.9); // without alignment it would miss
    expect(alignedSimilarity(texA, texture(2))).toBeLessThan(0.5);
  });

  it("flat images only match flat images of the same level", () => {
    const flat = new Uint8Array(GW * GH).fill(10);
    expect(alignedSimilarity(flat, new Uint8Array(GW * GH).fill(12))).toBe(1);
    expect(alignedSimilarity(flat, new Uint8Array(GW * GH).fill(200))).toBe(0);
    expect(alignedSimilarity(flat, texA)).toBe(0);
  });

  it("colour distance", () => {
    expect(colourDistance([0, 0, 0], [30, 30, 30])).toBe(30);
    expect(colourDistance([0], [0, 1])).toBe(255);
  });

  it("same view needs both shape and colour to match", () => {
    expect(sameView(fpA, { ...fpA, gray: encodeGray(shifted(texA, 1, 1)) })).toBe(true);
    expect(sameView(fpA, { ...fpA, gray: encodeGray(texture(3)) })).toBe(false);
    expect(sameView(fpA, { ...fpA, colour: Array(12).fill(180) })).toBe(false);
  });
});

describe("notebook", () => {
  it("context lines: only finished entries, newest last, capped, with age in minutes", () => {
    const entries = [
      entry({ at: NOW - 10 * 60_000, title: "old" }),
      entry({ status: "answering", title: "busy" }),
      entry({ status: "pending", title: "offline" }),
      ...Array.from({ length: 14 }, (_, i) => entry({ at: NOW - (14 - i) * 60_000, title: `n${i}` })),
    ];
    const lines = contextLines(entries, NOW);
    expect(lines).toHaveLength(12);
    expect(lines[11]).toMatchObject({ title: "n13", agoMin: 1 });
    expect(lines.map((l) => l.title)).not.toContain("busy");
  });

  it("finds the closest recent same-view look, never asks, replays or stale ones", () => {
    const close = entry({ fingerprint: { ...fpA, gray: encodeGray(shifted(texA, 2, 2)) }, title: "close" });
    const exact = entry({ fingerprint: fpA, title: "exact" });
    const entries = [
      entry({ mode: "ask", fingerprint: fpA, title: "ask" }),
      entry({ fingerprint: fpA, at: NOW - 31 * 60_000, title: "stale" }),
      entry({ fingerprint: fpA, cachedFrom: "x", title: "replay" }),
      close,
      exact,
    ];
    expect(findSameView(entries, fpA, NOW)?.title).toBe("exact");
    expect(findSameView([entries[0], entries[1], entries[2]], fpA, NOW)).toBeNull();
  });

  it("current place is the latest one guessed", () => {
    expect(currentPlace([entry({ place: "kitchen" }), entry({ place: "" }), entry({ place: "pharmacy" }), entry({})])).toBe("pharmacy");
    expect(currentPlace([])).toBe("");
  });

  it("sameAnswer ignores wording noise but catches a different product", () => {
    expect(sameAnswer("Ibuprofen 200 mg, a pain reliever.", "ibuprofen 200mg — a pain reliever")).toBe(true);
    expect(sameAnswer("Ibuprofen 200 mg, a pain reliever.", "Ibuprofen 400 mg, a pain reliever.")).toBe(false);
    expect(sameAnswer("Ibuprofen 200 mg, a pain reliever.", "Ibuprofen 200 mg pain reliever")).toBe(true);
    expect(sameAnswer("Ibuprofen 200 mg, a pain reliever.", "Acetaminophen 500 mg, for fever and pain.")).toBe(false);
  });
});

describe("quality", () => {
  it("dark before blurry, otherwise fine", () => {
    expect(judge(10, 500)).toBe("dark");
    expect(judge(120, 5)).toBe("blurry");
    expect(judge(120, 400)).toBeNull();
  });
});
