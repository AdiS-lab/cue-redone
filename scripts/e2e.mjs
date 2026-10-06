// End-to-end check of the real browser loop against the hub in mock mode.
//   npm run e2e         (starts the hub with LOOK_MOCK=1 and Vite itself, then drives headless Chromium)
// The webcam is faked with a canvas stream of images from test-images/; speech is recorded, not played.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const HUB_PORT = 8799;
const WEB_PORT = 5199;
const EXE = process.env.CHROMIUM ?? "/opt/pw-browsers/chromium";
const results = [];
const procs = [];

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

function start(cmd, args, env, ready) {
  return new Promise((resolve, reject) => {
    // own process group, so killing it also kills the node child that npx/tsx start
    const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"], detached: true });
    procs.push(p);
    const timer = setTimeout(() => reject(new Error(`${cmd} did not start`)), 30_000);
    const onData = (d) => {
      const s = d.toString();
      if (process.env.E2E_VERBOSE) process.stdout.write(`[${cmd}] ${s}`);
      if (ready.test(s)) {
        clearTimeout(timer);
        resolve(p);
      }
    };
    p.stdout.on("data", onData);
    p.stderr.on("data", onData);
  });
}

const startHub = (extra = {}) =>
  start("npx", ["tsx", "server/hub.ts"], { HUB_PORT: String(HUB_PORT), LOOK_MOCK: "1", LOOK_MOCK_DELAY_MS: "30", ANTHROPIC_API_KEY: "", ELEVENLABS_API_KEY: "", VOICE_MOCK_FILE: "", ...extra }, /\[hub\] http/);

const kill = (p) => {
  try {
    process.kill(-p.pid, "SIGTERM");
  } catch {
    // already gone
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let hub = await startHub();
  await start("npx", ["vite", "--port", String(WEB_PORT), "--strictPort"], { VITE_HUB_URL: `http://127.0.0.1:${HUB_PORT}` }, /Local:/);

  const browser = await chromium.launch({ executablePath: EXE, args: ["--no-proxy-server", "--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const logs = [];
  page.on("console", (m) => logs.push(m.text()));
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));

  await page.route("**/test-images/*", (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop();
    route.fulfill({ body: readFileSync(`test-images/${name}`), contentType: "image/jpeg" });
  });
  await page.addInitScript(() => {
    // Fake webcam: a canvas we can repaint with any image or colour.
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#888";
    ctx.fillRect(0, 0, 640, 480);
    let current = null;
    let fill = "#888";
    // repaint continuously: a canvas stream only emits frames when the canvas changes
    setInterval(() => {
      if (current) ctx.drawImage(current, 0, 0, 640, 480);
      else {
        ctx.fillStyle = fill;
        ctx.fillRect(0, 0, 640, 480);
      }
    }, 50);
    window.__setCam = (src) =>
      new Promise((resolve) => {
        if (src.startsWith("#")) {
          current = null;
          fill = src;
          ctx.fillStyle = src;
          ctx.fillRect(0, 0, 640, 480);
          return resolve();
        }
        const img = new Image();
        img.onload = () => {
          current = img;
          ctx.drawImage(img, 0, 0, 640, 480);
          resolve();
        };
        img.src = src;
      });
    navigator.mediaDevices.getUserMedia = async () => canvas.captureStream(20);
    navigator.mediaDevices.enumerateDevices = async () => [{ kind: "videoinput", deviceId: "fake", label: "fake cam", groupId: "" }];
    // Record speech instead of playing it.
    window.__spoken = [];
    window.speechSynthesis.speak = (u) => {
      window.__spoken.push({ text: u.text, at: performance.now() });
      setTimeout(() => u.onend && u.onend(new Event("end")), 20 + u.text.length * 2);
    };
    window.speechSynthesis.cancel = () => {};
    // No speech recognition in headless Chromium: the typed-question fallback is used.
    delete window.webkitSpeechRecognition;
    delete window.SpeechRecognition;
  });

  await page.goto(`http://127.0.0.1:${WEB_PORT}/?source=webcam`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.evaluate(() => window.__setCam("/test-images/pill-bottle-01.jpg"));
  await page.waitForFunction(() => document.querySelector("[data-testid=status]")?.textContent?.includes("brain: mock"), null, { timeout: 15_000 });
  check("hub status shows mock brain", true);
  await sleep(800);

  const spoken = () => page.evaluate(() => window.__spoken.map((s) => s.text));
  const entries = () => page.locator("[data-testid=entry]").count();

  // 1. Look
  let before = (await spoken()).length;
  const t0 = Date.now();
  await page.keyboard.press("Space");
  await page.waitForFunction((n) => window.__spoken.length > n, before, { timeout: 8000 });
  const firstWordMs = Date.now() - t0;
  await page.waitForFunction(() => document.querySelector("[data-testid=headline]")?.textContent?.startsWith("Mock answer"), null, { timeout: 8000 });
  await sleep(600);
  let said = (await spoken()).slice(before);
  check("look: headline spoken first", said[0]?.startsWith("Mock answer: a "), said[0]);
  check("look: detail spoken after headline", said[1] === "Add an Anthropic key to the hub for real answers.", said[1]);
  check("look: meta line never spoken", !said.some((s) => s.includes("@meta")));
  check("look: first sentence under 2 s (mock hub)", firstWordMs < 2000, `${firstWordMs} ms`);
  check("look: notebook has 1 entry", (await entries()) === 1);
  const title1 = await page.locator("[data-testid=entry]").first().textContent();
  check("look: notebook entry titled from @meta", title1.includes("Mock look 1"), title1);

  // 2. Same view again -> instant replay
  before = (await spoken()).length;
  const t1 = Date.now();
  await page.keyboard.press("Space");
  await page.waitForFunction((n) => window.__spoken.length > n, before, { timeout: 8000 });
  const replayMs = Date.now() - t1;
  await page.waitForSelector("text=instant replay", { timeout: 3000 });
  check("same view: instant replay badge", true);
  check("same view: spoken under 300 ms", replayMs < 300, `${replayMs} ms`);
  await sleep(1500);
  said = (await spoken()).slice(before);
  // the mock's answer mentions the look number, so the background re-check differs and is spoken as a correction
  check("same view: background re-check spoken as correction", said.some((s) => s.startsWith("Correction:")), said.join(" | "));

  // 3. Different object -> fresh answer, not a replay
  await page.evaluate(() => window.__setCam("/test-images/keys-01.jpg"));
  await sleep(600);
  before = (await spoken()).length;
  await page.keyboard.press("Space");
  await page.waitForFunction((n) => window.__spoken.length > n, before, { timeout: 8000 });
  await sleep(800);
  said = (await spoken()).slice(before);
  check("different view: not replayed", said[0]?.startsWith("Mock answer: a "), said[0]);
  check("different view: notebook sent as context", said[0]?.includes("look number 3"), said[0]);

  // 3b. Replay, then press again before the background re-check finishes
  await sleep(1500);
  await page.keyboard.press("Space");
  await sleep(80);
  await page.keyboard.press("Space");
  await sleep(2500);

  // 4. Fingerprint separation on the test images (same image vs different images)
  const fp = await page.evaluate(async () => {
    const { fingerprint, similarity, colourDistance } = await import("/src/lib/fingerprint.ts");
    const names = ["pill-bottle-01", "keys-01", "mug-01", "held-mug-01", "phone-01", "held-phone-01", "book-01", "remote-01", "water-bottle-01", "cluttered-desk-cup-01", "cluttered-desk-laptop-01", "cluttered-desk-mouse-01"];
    const imgs = await Promise.all(
      names.map(
        (n) =>
          new Promise((res) => {
            const i = new Image();
            i.onload = () => res(i);
            i.src = `/test-images/${n}.jpg`;
          })
      )
    );
    const shifted = (img, dx, dy, q) => {
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const x = c.getContext("2d");
      x.filter = `brightness(${q})`;
      x.drawImage(img, dx, dy);
      return c;
    };
    const same = imgs.map((img) => {
      const a = fingerprint(img);
      const b = fingerprint(shifted(img, Math.round(img.width * 0.03), Math.round(img.height * 0.03), 1.1));
      return { ncc: similarity(a, b), colour: colourDistance(a.colour, b.colour) };
    });
    const fps = imgs.map((i) => fingerprint(i));
    const diff = [];
    for (let i = 0; i < fps.length; i++)
      for (let j = i + 1; j < fps.length; j++) diff.push({ pair: `${names[i]}~${names[j]}`, ncc: similarity(fps[i], fps[j]), colour: colourDistance(fps[i].colour, fps[j].colour) });
    return { same, diff };
  });
  const f2 = (v) => v.toFixed(2);
  console.log("same-view ncc:", fp.same.map((x) => f2(x.ncc)).join(","), " different-image ncc (highest 5):", fp.diff.map((d) => d.ncc).sort((a, b) => b - a).slice(0, 5).map(f2).join(","));
  const minSame = Math.min(...fp.same.map((x) => x.ncc));
  const sameColour = Math.max(...fp.same.map((x) => x.colour));
  const collisions = fp.diff.filter((d) => d.ncc >= 0.9 && d.colour <= 28);
  const maxDiff = Math.max(...fp.diff.map((d) => d.ncc));
  check("fingerprint: same view (3% shift, +10% light) matches", minSame >= 0.9 && sameColour <= 28, `min ncc ${f2(minSame)}, colour ${sameColour.toFixed(1)}`);
  check("fingerprint: no different-image collisions", collisions.length === 0, `max ncc ${f2(maxDiff)}; collisions ${collisions.map((c) => c.pair).join(",")}`);

  // 5. Typed question (no speech recognition) -> ask with photo
  before = (await spoken()).length;
  await page.fill("[data-testid=ask-input]", "is this mine?");
  await page.click("[data-testid=ask-submit]");
  await page.waitForFunction((n) => window.__spoken.some((s, i) => i >= n && s.text.includes("is this mine?")), before, { timeout: 8000 });
  check("ask: answer mentions the question", true);
  check("ask: notebook entry shows the question", (await page.locator("[data-testid=answer]").textContent()).includes("“is this mine?”"));

  // 6. Hold (H) without speech recognition waits for a typed question
  before = (await spoken()).length;
  await page.keyboard.press("KeyH");
  await page.waitForFunction(() => document.querySelector("[data-testid=ask-input]")?.placeholder.startsWith("Type your question"), null, { timeout: 4000 });
  await page.fill("[data-testid=ask-input]", "what color is it?");
  await page.press("[data-testid=ask-input]", "Enter");
  await page.waitForFunction((n) => window.__spoken.some((s, i) => i >= n && s.text.includes("what color is it?")), before, { timeout: 8000 });
  check("hold: typed fallback question answered", true);

  // 7. More (D)
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  before = (await spoken()).length;
  await page.keyboard.press("KeyD");
  await page.waitForFunction((n) => window.__spoken.some((s, i) => i >= n && s.text.startsWith("Mock detail")), before, { timeout: 8000 });
  check("more: deeper answer spoken", true);

  // 8. Recall from the notebook (typed, photo-less is decided by the model; here the photo exists so ask mode)
  // 9. Goal
  await page.fill("[data-testid=ask-input]", "my goal is find gluten free snacks");
  await page.click("[data-testid=ask-submit]");
  await page.waitForSelector("[data-testid=goal]", { timeout: 4000 });
  check("goal: spoken goal is set", (await page.locator("[data-testid=goal]").textContent()).includes("find gluten free snacks"));

  // 10. Dark photo -> on-device refusal, no network, no entry
  const n10 = await entries();
  await page.evaluate(() => window.__setCam("#050505"));
  await sleep(500);
  before = (await spoken()).length;
  const t10 = Date.now();
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Space");
  await page.waitForFunction((n) => window.__spoken.length > n, before, { timeout: 4000 });
  said = (await spoken()).slice(before);
  check("dark: refused on device", said[0]?.startsWith("Too dark"), said[0]);
  check("dark: under 500 ms", Date.now() - t10 < 500, `${Date.now() - t10} ms`);
  check("dark: no notebook entry", (await entries()) === n10);

  // 11. Hub down -> saved for later, answered when it comes back
  await page.evaluate(() => window.__setCam("/test-images/book-01.jpg"));
  await sleep(500);
  kill(hub);
  await sleep(500);
  before = (await spoken()).length;
  await page.keyboard.press("Space");
  await page.waitForFunction((n) => window.__spoken.some((s, i) => i >= n && s.text.startsWith("Can't reach Qu")), before, { timeout: 10_000 });
  check("offline: tells the user and saves the look", (await page.locator("text=saved for later").count()) > 0);
  hub = await startHub();
  await page.waitForFunction((n) => window.__spoken.some((s, i) => i >= n && s.text.startsWith("About your earlier photo")), before, { timeout: 20_000 });
  check("offline: pending look answered when the hub is back", true);

  const failedEntries = await page.evaluate(() => JSON.parse(localStorage.getItem("qu.notebook.v1") ?? "[]").filter((e) => e.status === "error" && e.headline !== "Interrupted").map((e) => e.headline));
  check("interrupted answers are kept, not marked failed", failedEntries.length === 0, failedEntries.join(" | "));
  const stuck = await page.evaluate(() => JSON.parse(localStorage.getItem("qu.notebook.v1") ?? "[]").filter((e) => e.status === "answering").length);
  check("no entry left 'answering' after interruptions", stuck === 0, `${stuck} stuck`);
  // 12. Persistence across reload, and End session
  const nBefore = await entries();
  await page.reload();
  await page.waitForSelector("[data-testid=entry]");
  check("notebook survives a reload", (await entries()) === nBefore, `${nBefore} entries`);
  await page.screenshot({ path: (process.env.E2E_SCREENSHOT ?? "e2e-screenshot.png").replace(/\.png$/, "-session.png") });
  await page.click("[data-testid=end-session]");
  check("end session clears the notebook and goal", (await entries()) === 0 && (await page.locator("[data-testid=goal]").count()) === 0);

  // 13. The ring path: a fake ring speaking the firmware protocol through the hub's /phone relay
  const ringOut = [];
  const ring = spawn("node", ["scripts/fake-ring.mjs", "--hub", `ws://127.0.0.1:${HUB_PORT}/phone`, "--image", "pill-bottle-01.jpg"], { stdio: ["pipe", "pipe", "pipe"], detached: true });
  procs.push(ring);
  ring.stdout.on("data", (d) => ringOut.push(...d.toString().trim().split("\n")));
  await page.goto(`http://127.0.0.1:${WEB_PORT}/?source=ws&url=${encodeURIComponent(`ws://127.0.0.1:${HUB_PORT}/ring`)}&mode=still&button=ws`);
  await page.waitForFunction(() => document.querySelector("[data-testid=status]")?.textContent?.includes("brain: mock"), null, { timeout: 15_000 });
  for (let i = 0; i < 50 && !ringOut.some((l) => l.includes("connected")); i++) await sleep(100);
  await sleep(1000);
  before = (await spoken()).length;
  const tr = Date.now();
  ring.stdin.write("c\n");
  await page.waitForFunction((n) => window.__spoken.some((s, i) => i >= n && s.text.startsWith("Mock answer")), before, { timeout: 10_000 });
  check("ring: click on the board -> photo burst through the hub -> spoken answer", true, `${Date.now() - tr} ms press to first sentence`);
  check("ring: board sent a burst (3 photos + 1 discarded wake frame)", ringOut.some((l) => l.includes("sent 4 x pill-bottle-01.jpg")), ringOut.filter((l) => l.includes("sent")).join(" | "));
  await sleep(300);
  check("ring: board got 'captured' feedback", ringOut.some((l) => l.includes("feedback captured")), ringOut.filter((l) => l.includes("feedback")).join(" | "));
  before = (await spoken()).length;
  ring.stdin.write("d\n");
  await page.waitForFunction((n) => window.__spoken.some((s, i) => i >= n && s.text.startsWith("Mock detail")), before, { timeout: 10_000 });
  check("ring: double on the board -> more", true);

  // The firmware sends "click" on release and "double" right after a second press: more must use the new look's photo.
  await sleep(1500);
  ring.stdin.write("n keys-01.jpg\n");
  await sleep(200);
  before = (await spoken()).length;
  const nBeforeDouble = await entries();
  ring.stdin.write("c\n");
  await sleep(120); // second press arrives while the click's burst is still in flight
  ring.stdin.write("d\n");
  await page.waitForFunction((n) => window.__spoken.some((s, i) => i >= n && s.text.startsWith("Mock detail")), before, { timeout: 10_000 });
  await sleep(500);
  said = (await spoken()).slice(before);
  const latest = await page.evaluate(() => JSON.parse(localStorage.getItem("qu.notebook.v1") ?? "[]").slice(-2).map((e) => ({ mode: e.mode, thumb: e.thumb?.length ?? 0 })));
  check("ring: click-then-double gives more about the new look", latest[0]?.mode === "look" && latest[1]?.mode === "more" && (await entries()) === nBeforeDouble + 2, JSON.stringify(latest));
  check("ring: click-then-double doesn't say 'point at something first'", !said.some((s) => s.startsWith("Point at")), said.join(" | "));

  // 14. Streamed voice: the hub's mock voice sends an mp3 in 8 chunks 150 ms apart (like ElevenLabs generating);
  //     playback must start before the download finishes.
  const tone = join(mkdtempSync(join(tmpdir(), "qu-e2e-")), "tone.mp3");
  const ff = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-ac", "1", "-ar", "44100", "-b:a", "64k", tone]);
  if (ff.status !== 0) {
    console.log("SKIP  streamed voice (ffmpeg not available)");
  } else {
    kill(hub);
    await sleep(500);
    hub = await startHub({ VOICE_MOCK_FILE: tone, VOICE_MOCK_CHUNK_MS: "150" });
    await page.goto(`http://127.0.0.1:${WEB_PORT}/?source=webcam`);
    await page.evaluate(() => window.__setCam("/test-images/mug-01.jpg"));
    await page.waitForFunction(() => document.querySelector("[data-testid=status]")?.textContent?.includes("ElevenLabs"), null, { timeout: 20_000 });
    await sleep(800);
    const nLogs = logs.length;
    before = (await spoken()).length;
    await page.keyboard.press("Space");
    await page.waitForFunction(() => document.querySelector("[data-testid=headline]")?.textContent?.startsWith("Mock answer"), null, { timeout: 8000 });
    for (let i = 0; i < 60 && !logs.slice(nLogs).some((l) => l.includes("audio playing")); i++) await sleep(100);
    const playLine = logs.slice(nLogs).find((l) => l.includes("audio playing")) ?? "";
    const playMs = Number(/playing (\d+) ms/.exec(playLine)?.[1] ?? NaN);
    check("voice: hub voice used (no browser fallback)", (await spoken()).length === before, `${(await spoken()).length - before} browser utterances`);
    check("voice: playback starts before the audio finished streaming (8 x 150 ms)", playMs < 1000, playLine || "no playing event");
  }

  const errors = logs.filter((l) => l.startsWith("pageerror"));
  check("no page errors", errors.length === 0, errors.join(" | "));
  const timing = logs.filter((l) => l.startsWith("[qu]"));
  console.log(timing.slice(0, 4).join("\n"));
  await page.screenshot({ path: process.env.E2E_SCREENSHOT ?? "e2e-screenshot.png" });
  await browser.close();
}

main()
  .catch((err) => {
    console.error(err);
    results.push({ name: "run", ok: false });
  })
  .finally(() => {
    for (const p of procs) kill(p);
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    process.exit(failed.length ? 1 : 0);
  });
