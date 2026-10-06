// What Qu says and how it is asked. Pure functions so tests can check them without the network.
//
// Output contract (the browser relies on it):
//   line 1     spoken headline, at most ~15 words
//   lines 2+   optional detail sentences (also spoken)
//   last line  @meta {"kind":..., "title":..., "place":...}   (never spoken; feeds the notebook)

export type LookMode = "look" | "ask" | "more" | "recall";
export const LOOK_MODES: readonly LookMode[] = ["look", "ask", "more", "recall"];

/** One earlier look, as the browser's notebook sends it. */
export interface NotebookLine {
  /** Minutes before this request. */
  agoMin: number;
  title: string;
  headline: string;
  kind?: string;
  place?: string;
  question?: string;
  detail?: string;
}

export interface LookRequest {
  mode: LookMode;
  /** Base64 JPEG without the data: prefix. Required for look, ask with a photo, and more. */
  image?: string;
  question?: string;
  notebook: NotebookLine[];
  goal?: string;
  /** For "more": what Qu already said about this photo. */
  previous?: string;
}

export const MAX_IMAGE_BASE64 = 1_500_000; // ~1.1 MB JPEG, far above what the ring sends
const MAX_NOTEBOOK = 20;
const MAX_TEXT = 600;

export class BadRequest extends Error {}

function text(v: unknown, field: string, max = MAX_TEXT): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string") throw new BadRequest(`${field} must be a string`);
  return v.trim().slice(0, max) || undefined;
}

export function parseLookRequest(body: unknown): LookRequest {
  if (!body || typeof body !== "object") throw new BadRequest("body must be a JSON object");
  const b = body as Record<string, unknown>;
  const mode = b.mode;
  if (typeof mode !== "string" || !(LOOK_MODES as readonly string[]).includes(mode)) {
    throw new BadRequest(`mode must be one of ${LOOK_MODES.join(", ")}`);
  }
  let image: string | undefined;
  if (b.image !== undefined && b.image !== null && b.image !== "") {
    if (typeof b.image !== "string") throw new BadRequest("image must be a base64 string");
    image = b.image.replace(/^data:image\/jpeg;base64,/, "");
    if (image.length > MAX_IMAGE_BASE64) throw new BadRequest("image is too large");
    if (!/^[A-Za-z0-9+/]+=*$/.test(image.slice(0, 200))) throw new BadRequest("image must be base64 JPEG");
  }
  const question = text(b.question, "question");
  if ((mode === "look" || mode === "more") && !image) throw new BadRequest(`${mode} needs an image`);
  if ((mode === "ask" || mode === "recall") && !question) throw new BadRequest(`${mode} needs a question`);
  const rawNotebook = Array.isArray(b.notebook) ? b.notebook.slice(-MAX_NOTEBOOK) : [];
  const notebook: NotebookLine[] = rawNotebook.flatMap((n): NotebookLine[] => {
    if (!n || typeof n !== "object") return [];
    const e = n as Record<string, unknown>;
    const headline = text(e.headline, "notebook.headline", 300);
    if (!headline) return [];
    return [
      {
        agoMin: typeof e.agoMin === "number" && Number.isFinite(e.agoMin) ? Math.max(0, Math.round(e.agoMin)) : 0,
        title: text(e.title, "notebook.title", 60) ?? "",
        headline,
        kind: text(e.kind, "notebook.kind", 20),
        place: text(e.place, "notebook.place", 60),
        question: text(e.question, "notebook.question", 200),
        detail: text(e.detail, "notebook.detail", 400),
      },
    ];
  });
  return {
    mode: mode as LookMode,
    image,
    question,
    notebook,
    goal: text(b.goal, "goal", 200),
    previous: text(b.previous, "previous", 1200),
  };
}

// Stable across requests so it can be cached. Nothing per-request goes in here.
export const SYSTEM_PROMPT = `You are Qu, the voice of a camera ring. The wearer points the ring at something and presses its button; you get the photo the ring took and answer out loud through an earbud.

The photo comes from a tiny fixed-focus camera on the wearer's hand: wide angle, modest resolution, sometimes tilted, close up or soft. The thing they pointed at is usually near the centre.

How to answer:
- Line 1 is the headline: the single most useful thing to know right now, in at most 15 words of plain spoken English. It is spoken first, so it must stand on its own.
- Then at most two more short sentences, and only if they add something the wearer would want. Silence is better than filler.
- Never use markdown, lists, emojis, URLs or symbols that sound odd read aloud. Write numbers the way you'd say them ("two hundred milligrams" can stay "200 mg").
- Never open with "This image shows", "I see" or "The photo". Talk like a quick, helpful friend.

Decide what they most likely want from what is in the shot:
- Text (label, sign, page, screen, receipt, menu): read the part that matters, then say what it means. For medicine: name, strength, what it is for, and a dose or warning only if it is printed and readable; otherwise say to check the label. Never invent numbers you cannot read.
- An object or product: what it is plus the one fact that is useful about it.
- A room or scene: where they are and what is notable, placed relative to them (ahead, left, right, near, far).
- A person: describe what is visible (clothing, what they are doing). Never say who they are, and never guess age, ethnicity, health or other sensitive traits.
- If you cannot tell because the photo is blurry, too dark or too close, say so and say what to do ("Too close, pull back a little").

Use the session notebook. It lists what they pointed at earlier, newest last, and sometimes a goal. Let it shape your answer: the same box means something different in a pharmacy and in a kitchen, and a goal like a nut allergy should change what you mention. If this is the same thing as an earlier look, say so in a few words and add only what is new. Do not recite the notebook back.

Finish with one final line, exactly in this form, which is never spoken:
@meta {"kind":"text|object|scene|person|unclear","title":"two to four word name","place":"short guess of where they are, or empty"}`;

const MODE_INSTRUCTIONS: Record<LookMode, string> = {
  look: "They pressed once: explain what they are pointing at.",
  ask: "They held the button and asked the question below about what they are pointing at. Answer the question first, in the headline.",
  more: "They double-pressed: they want more about the same photo. Do not repeat what was already said. Give up to six short spoken sentences of genuinely useful depth, most useful first; the headline still comes first and stands alone.",
  recall:
    "They asked the question below without a new photo. Answer from the session notebook only. If the notebook does not contain the answer, say you did not catch that earlier. Use kind \"unclear\" and an empty place in @meta unless the notebook tells you.",
};

function ago(min: number): string {
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  return `${Math.round(min / 60)} h ago`;
}

export function notebookText(notebook: NotebookLine[], goal?: string): string {
  const lines: string[] = [];
  if (goal) lines.push(`Goal: ${goal}`);
  if (notebook.length === 0) lines.push("No earlier looks this session.");
  for (const n of notebook) {
    const where = n.place ? ` @ ${n.place}` : "";
    const asked = n.question ? ` (asked: "${n.question}")` : "";
    const detail = n.detail ? ` ${n.detail}` : "";
    lines.push(`- ${ago(n.agoMin)}${where} [${n.kind ?? "?"}] ${n.title || "untitled"}${asked}: ${n.headline}${detail}`);
  }
  return lines.join("\n");
}

type Block =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: "image/jpeg"; data: string } };

/** The user turn: notebook, then the photo, then the instruction (and question) last. */
export function userContent(req: LookRequest): Block[] {
  const blocks: Block[] = [{ type: "text", text: `Session notebook:\n${notebookText(req.notebook, req.goal)}` }];
  if (req.image) blocks.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: req.image } });
  let instruction = MODE_INSTRUCTIONS[req.mode];
  if (req.mode === "ask" && !req.image) instruction = MODE_INSTRUCTIONS.recall;
  if (req.question) instruction += `\nQuestion: "${req.question}"`;
  if (req.previous) instruction += `\nAlready said: "${req.previous}"`;
  blocks.push({ type: "text", text: instruction });
  return blocks;
}
