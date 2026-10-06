// Stand-in for the ESP32-CAM firmware (firmware/qu-ring): connects to the hub's /phone endpoint exactly like the
// board does, answers {"type":"capture"} with JPEGs from a folder, and sends button gestures typed on stdin.
//   node scripts/fake-ring.mjs [--hub ws://localhost:8787/phone] [--dir test-images] [--image pill-bottle-01.jpg]
//   then type c / d / h + Enter (click / double / hold), or n + Enter to point at the next image.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const hub = opt("hub", "ws://localhost:8787/phone");
const dir = opt("dir", "test-images");
const files = readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f)).sort();
let index = Math.max(0, files.indexOf(opt("image", files[0])));

let ws = null;
function connect() {
  ws = new WebSocket(hub);
  ws.on("open", () => console.log(`[fake-ring] connected to ${hub}, pointing at ${files[index]}`));
  ws.on("close", () => setTimeout(connect, 1000));
  ws.on("error", () => {});
  ws.on("message", (data, isBinary) => {
    if (isBinary) return;
    const text = data.toString();
    if (text.includes('"capture"')) {
      const count = Math.max(1, Math.min(5, Number(/"count":(\d+)/.exec(text)?.[1] ?? 1)));
      const jpeg = readFileSync(join(dir, files[index]));
      for (let i = 0; i < count; i++) ws.send(jpeg, { binary: true });
      ws.send(JSON.stringify({ type: "burst-end" }));
      console.log(`[fake-ring] sent ${count} x ${files[index]}`);
    } else if (text.includes('"feedback"')) {
      console.log(`[fake-ring] feedback ${/"kind":"([^"]+)"/.exec(text)?.[1]}`);
    }
  });
}
connect();

const KEYS = { c: "click", d: "double", h: "hold" };
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  for (const line of chunk.split("\n")) {
    const k = line.trim();
    if (k.startsWith("n")) {
      index = k.length > 2 ? Math.max(0, files.indexOf(k.slice(2).trim())) : (index + 1) % files.length;
      console.log(`[fake-ring] pointing at ${files[index]}`);
    } else if (KEYS[k[0]] && ws?.readyState === WebSocket.OPEN) {
      ws.send(KEYS[k[0]]);
      console.log(`[fake-ring] ${KEYS[k[0]]}`);
    }
  }
});
