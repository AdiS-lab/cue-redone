import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BadRequest, SYSTEM_PROMPT, notebookText, parseLookRequest, userContent } from "./prompt.ts";

const JPEG = Buffer.from("ffd8ffe000104a464946", "hex").toString("base64");

describe("parseLookRequest", () => {
  it("accepts a look with an image and strips a data: prefix", () => {
    const r = parseLookRequest({ mode: "look", image: `data:image/jpeg;base64,${JPEG}` });
    expect(r.mode).toBe("look");
    expect(r.image).toBe(JPEG);
    expect(r.notebook).toEqual([]);
  });

  it("rejects unknown modes, missing images and missing questions", () => {
    expect(() => parseLookRequest({ mode: "dance" })).toThrow(BadRequest);
    expect(() => parseLookRequest({ mode: "look" })).toThrow(/needs an image/);
    expect(() => parseLookRequest({ mode: "more" })).toThrow(/needs an image/);
    expect(() => parseLookRequest({ mode: "ask", image: JPEG })).toThrow(/needs a question/);
    expect(() => parseLookRequest({ mode: "recall" })).toThrow(/needs a question/);
    expect(() => parseLookRequest({ mode: "look", image: "not base64!!" })).toThrow(/base64/);
    expect(() => parseLookRequest(null)).toThrow(BadRequest);
  });

  it("keeps only valid notebook lines, newest 20, and clamps fields", () => {
    const notebook = [
      { headline: "" },
      "junk",
      ...Array.from({ length: 25 }, (_, i) => ({ agoMin: 30 - i, title: `t${i}`, headline: `h${i}`, kind: "object" })),
    ];
    const r = parseLookRequest({ mode: "recall", question: "what was that?", notebook });
    expect(r.notebook).toHaveLength(20);
    expect(r.notebook[19]).toMatchObject({ title: "t24", headline: "h24", agoMin: 6 });
  });
});

describe("prompt", () => {
  it("system prompt is stable and asks for the meta line", () => {
    expect(SYSTEM_PROMPT).toContain("@meta");
    expect(SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/); // no dates: it must stay cacheable
  });

  it("notebook text includes goal, place, question and age", () => {
    const text = notebookText(
      [
        { agoMin: 0, title: "Ibuprofen", headline: "Ibuprofen 200 mg, for pain.", kind: "text", place: "pharmacy" },
        { agoMin: 75, title: "Shelf", headline: "Cold medicine aisle.", question: "where am I?" },
      ],
      "nut allergy"
    );
    expect(text).toContain("Goal: nut allergy");
    expect(text).toContain("just now @ pharmacy [text] Ibuprofen: Ibuprofen 200 mg");
    expect(text).toContain('1 h ago [?] Shelf (asked: "where am I?")');
    expect(notebookText([])).toBe("No earlier looks this session.");
  });

  it("puts the photo before the instruction and the question last", () => {
    const blocks = userContent({ mode: "ask", image: JPEG, question: "is this vegan?", notebook: [] });
    expect(blocks.map((b) => b.type)).toEqual(["text", "image", "text"]);
    const last = blocks[2];
    expect(last.type === "text" && last.text).toMatch(/Answer the question first[\s\S]*is this vegan\?/);
  });

  it("an ask without a photo becomes a notebook recall", () => {
    const blocks = userContent({ mode: "ask", question: "what did the label say?", notebook: [] });
    expect(blocks.map((b) => b.type)).toEqual(["text", "text"]);
    const last = blocks[1];
    expect(last.type === "text" && last.text).toMatch(/session notebook only/);
  });
});

describe("POST /look (mock)", () => {
  let server: Server;
  let base = "";

  beforeAll(async () => {
    process.env.LOOK_MOCK = "1";
    process.env.LOOK_MOCK_DELAY_MS = "0";
    const { handleLook } = await import("./look.ts");
    server = createServer((req, res) => void handleLook(req, res));
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  async function events(body: unknown): Promise<{ status: number; events: Record<string, unknown>[] }> {
    const res = await fetch(`${base}/look`, { method: "POST", body: JSON.stringify(body) });
    const text = await res.text();
    if (res.status !== 200) return { status: res.status, events: [JSON.parse(text) as Record<string, unknown>] };
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    return {
      status: 200,
      events: text
        .split("\n\n")
        .filter((l) => l.startsWith("data: "))
        .map((l) => JSON.parse(l.slice(6)) as Record<string, unknown>),
    };
  }

  it("streams text then done", async () => {
    const { status, events: ev } = await events({ mode: "look", image: JPEG, notebook: [{ title: "a", headline: "b" }] });
    expect(status).toBe(200);
    const text = ev.filter((e) => e.type === "text").map((e) => e.text).join("");
    expect(text).toMatch(/^Mock answer: .*look number 2/);
    expect(text).toMatch(/\n@meta \{.*\}$/);
    expect(ev[ev.length - 1]).toMatchObject({ type: "done", model: "mock" });
  });

  it("recall answers from the notebook", async () => {
    const { events: ev } = await events({ mode: "recall", question: "what was it?", notebook: [{ title: "Keys", headline: "Your keys, on the hook." }] });
    const text = ev.filter((e) => e.type === "text").map((e) => e.text).join("");
    expect(text).toContain("Earlier you looked at Keys: Your keys, on the hook.");
  });

  it("400 on a bad request, as JSON", async () => {
    const { status, events: ev } = await events({ mode: "look" });
    expect(status).toBe(400);
    expect(ev[0].error).toMatch(/needs an image/);
  });
});
