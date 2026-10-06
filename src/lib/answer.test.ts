import { describe, expect, it } from "vitest";
import { AnswerStream, parseMeta, takeSentences } from "./answer";

const FULL =
  "Ibuprofen 200 mg, a pain reliever.\nTake one to two every four to six hours. Don't exceed six a day.\n@meta {\"kind\":\"text\",\"title\":\"Ibuprofen bottle\",\"place\":\"pharmacy\"}";

describe("takeSentences", () => {
  it("splits on sentence ends followed by space and on newlines", () => {
    expect(takeSentences("One. Two! Three? Fo")).toEqual([["One.", "Two!", "Three?"], " Fo"]);
    expect(takeSentences("Line one\nLine")).toEqual([["Line one"], "Line"]);
  });

  it("keeps decimals and abbreviations inside a sentence", () => {
    expect(takeSentences("Take 2.5 ml. Ask Dr. Smith first. ")).toEqual([["Take 2.5 ml.", "Ask Dr. Smith first."], " "]);
  });
});

describe("parseMeta", () => {
  it("parses and sanitises", () => {
    expect(parseMeta('@meta {"kind":"scene","title":"Kitchen","place":"home"}')).toEqual({ kind: "scene", title: "Kitchen", place: "home" });
    expect(parseMeta('@meta {"kind":"weird","title":3}')).toEqual({ kind: "unclear", title: "", place: "" });
    expect(parseMeta("@meta {broken")).toBeNull();
    expect(parseMeta("hello")).toBeNull();
  });
});

describe("AnswerStream", () => {
  it("yields the headline as soon as it is complete and never speaks the meta line", () => {
    const a = new AnswerStream();
    const spoken: string[] = [];
    // feed in awkward 3-character chunks, like a token stream
    for (let i = 0; i < FULL.length; i += 3) {
      const got = a.push(FULL.slice(i, i + 3));
      spoken.push(...got);
      if (i < 40 && got.length) expect(got[0]).toBe("Ibuprofen 200 mg, a pain reliever.");
    }
    spoken.push(...a.end());
    expect(spoken).toEqual([
      "Ibuprofen 200 mg, a pain reliever.",
      "Take one to two every four to six hours.",
      "Don't exceed six a day.",
    ]);
    expect(spoken.join(" ")).not.toContain("@meta");
    expect(a.result()).toEqual({
      headline: "Ibuprofen 200 mg, a pain reliever.",
      detail: "Take one to two every four to six hours. Don't exceed six a day.",
      meta: { kind: "text", title: "Ibuprofen bottle", place: "pharmacy" },
    });
  });

  it("flushes an unterminated last sentence and a meta line without newline", () => {
    const a = new AnswerStream();
    expect(a.push("Your keys, on the hook")).toEqual([]);
    expect(a.end()).toEqual(["Your keys, on the hook"]);
    const b = new AnswerStream();
    b.push('Kitchen counter.\n@meta {"kind":"scene","title":"Counter","place":"kitchen"}');
    expect(b.end()).toEqual([]);
    expect(b.result().meta?.place).toBe("kitchen");
    expect(b.result().headline).toBe("Kitchen counter.");
  });

  it("a headline line without punctuation is spoken at its newline", () => {
    const a = new AnswerStream();
    expect(a.push("Exit sign ahead")).toEqual([]);
    expect(a.push("\nDoor is on your left.")).toEqual(["Exit sign ahead"]);
    expect(a.end()).toEqual(["Door is on your left."]);
    expect(a.result()).toMatchObject({ headline: "Exit sign ahead", detail: "Door is on your left." });
  });
});
