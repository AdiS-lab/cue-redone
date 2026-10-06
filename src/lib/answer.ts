// Turns Qu's streamed answer into speakable sentences as soon as each one is complete.
// The answer contract (server/prompt.ts): headline line, optional detail, final "@meta {json}" line.
// The meta line is never spoken.

export interface AnswerMeta {
  kind: "text" | "object" | "scene" | "person" | "unclear";
  title: string;
  place: string;
}

export interface Answer {
  headline: string;
  detail: string;
  meta: AnswerMeta | null;
}

const KINDS: AnswerMeta["kind"][] = ["text", "object", "scene", "person", "unclear"];
// "Dr. Smith", "St. Louis", "e.g. this" must not end a sentence.
const ABBREVIATIONS = /(?:\b(?:Dr|Mr|Mrs|Ms|St|vs|No|approx|e\.g|i\.e|etc))\.$/i;

export function parseMeta(line: string): AnswerMeta | null {
  const m = /^@meta\s*(\{.*\})\s*$/.exec(line.trim());
  if (!m) return null;
  try {
    const raw = JSON.parse(m[1]) as Partial<Record<keyof AnswerMeta, unknown>>;
    const kind = KINDS.includes(raw.kind as AnswerMeta["kind"]) ? (raw.kind as AnswerMeta["kind"]) : "unclear";
    return {
      kind,
      title: typeof raw.title === "string" ? raw.title.slice(0, 60) : "",
      place: typeof raw.place === "string" ? raw.place.slice(0, 60) : "",
    };
  } catch {
    return null;
  }
}

/** Split complete sentences off the front of `text`; returns [sentences, rest]. */
export function takeSentences(text: string): [string[], string] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    const endsLine = c === "\n";
    const endsSentence = (c === "." || c === "!" || c === "?") && next !== undefined && /\s/.test(next);
    if (!endsLine && !endsSentence) continue;
    const piece = text.slice(start, i + 1);
    if (endsSentence && ABBREVIATIONS.test(piece.trim())) continue;
    const s = piece.trim();
    if (s) out.push(s);
    start = i + 1;
  }
  return [out, text.slice(start)];
}

/**
 * Feed text deltas in, get sentences out the moment they are complete.
 * A line that starts with "@" is held back until its end so the meta line is never spoken.
 */
export class AnswerStream {
  private pending = "";
  private lines: string[] = [];
  private current = "";
  private meta: AnswerMeta | null = null;

  push(delta: string): string[] {
    this.pending += delta;
    const ready: string[] = [];
    for (;;) {
      const nl = this.pending.indexOf("\n");
      const line = nl >= 0 ? this.pending.slice(0, nl) : this.pending;
      if (line.trimStart().startsWith("@")) {
        if (nl < 0) break; // wait for the whole meta line
        this.meta = parseMeta(line) ?? this.meta;
        this.pending = this.pending.slice(nl + 1);
        continue;
      }
      const [sentences, rest] = takeSentences(nl >= 0 ? `${line}\n` : line);
      for (const s of sentences) this.add(s, false);
      ready.push(...sentences);
      if (nl < 0) {
        this.pending = rest;
        break;
      }
      this.endLine();
      this.pending = this.pending.slice(nl + 1);
    }
    return ready;
  }

  /** Flush whatever is left (the stream ended). Returns the last sentences to speak. */
  end(): string[] {
    const rest = this.pending.trim();
    this.pending = "";
    if (!rest) return [];
    if (rest.startsWith("@")) {
      this.meta = parseMeta(rest) ?? this.meta;
      return [];
    }
    this.add(rest, true);
    return [rest];
  }

  private add(sentence: string, final: boolean): void {
    this.current = this.current ? `${this.current} ${sentence}` : sentence;
    if (final) this.endLine();
  }

  private endLine(): void {
    if (this.current) this.lines.push(this.current);
    this.current = "";
  }

  result(): Answer {
    const lines = this.current ? [...this.lines, this.current] : this.lines;
    return { headline: lines[0] ?? "", detail: lines.slice(1).join(" "), meta: this.meta };
  }
}
