// Phase 0 spike: listen only (send nothing first) and answer the first text message once.
// Checks that a user texting our line reaches this process. Credentials from .env.
// Run: npm run spike:listen -- [seconds]
import { Spectrum, text } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";

const listenSeconds = Number(process.argv[2] ?? 300);
const mask = (s: string) => s.replace(/\d(?=\d{4})/g, "•");
const app = await Spectrum({ providers: [imessage.config()], telemetry: false, options: { logLevel: "warn" } });
console.log(`[listen] up; waiting ${listenSeconds} s for an inbound text`);
const t0 = Date.now();
const stop = setTimeout(async () => { console.log("[listen] window over, nothing received"); await app.stop(); process.exit(0); }, listenSeconds * 1000);

for await (const [space, message] of app.messages) {
  const at = ((Date.now() - t0) / 1000).toFixed(1);
  const from = mask(String(message.sender?.id ?? "?"));
  if (message.content.type !== "text") { console.log(`[listen] +${at}s event (${message.content.type}) from ${from}`); continue; }
  console.log(`[listen] +${at}s text from ${from} in space ${mask(String((space as { id?: string }).id))}: ${message.content.text}`);
  await space.responding(async () => { await space.send(text("Thermal Reserve test: your text reached us. Simulation only; no reply needed.")); });
  clearTimeout(stop);
  await app.stop();
  process.exit(0);
}
