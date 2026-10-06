// npm run voice -- status | clone <audio file...> --name "Dad"
import "./env.ts";
import { cloneVoice, configured, currentVoice } from "./voice.ts";

const [cmd, ...rest] = process.argv.slice(2);
const nameAt = rest.indexOf("--name");
const name = nameAt >= 0 ? rest[nameAt + 1] : "Qu voice";
const files = rest.filter((a, i) => !a.startsWith("--") && i !== nameAt + 1);

if (!configured()) {
  console.error("ELEVENLABS_API_KEY is not set in server/.env.local");
  process.exit(1);
}
if (cmd === "status") {
  console.log(currentVoice());
} else if (cmd === "clone" && files.length > 0) {
  const id = await cloneVoice(files, name);
  console.log(`cloned "${name}" -> ${id} (saved to server/voice.json).`);
} else {
  console.error('usage: npm run voice -- status | clone <audio files> --name "Dad"');
  process.exit(1);
}
