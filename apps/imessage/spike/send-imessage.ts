// Phase 0 spike: one outbound iMessage from Linux via Spectrum cloud, then listen for replies.
// Credentials come from SPECTRUM_PROJECT_ID / SPECTRUM_PROJECT_SECRET; recipient from CHAT_TEST_PHONE.
import { Spectrum, text } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";

const phone = process.env.CHAT_TEST_PHONE;
if (!phone) throw new Error("CHAT_TEST_PHONE not set");
const listenSeconds = Number(process.argv[2] ?? 90);
const masked = phone.slice(0, -4).replace(/\d/g, "•") + phone.slice(-4);

const app = await Spectrum({ providers: [imessage.config()], telemetry: false, options: { logLevel: "warn" } });
console.log("[spike] spectrum up; project", (app as { config?: { slug?: string } }).config?.slug ?? "?");

const im = imessage(app);
const user = await im.user(phone);
const dm = await im.space.create(user);
console.log(`[spike] DM ready with ${masked}; space type`, (dm as { type?: string }).type);

const t0 = Date.now();
await dm.send(text("BoreaFlux test from the team's iMessage assistant (simulation only). Reply anything to check that replies reach us."));
console.log(`[spike] sent in ${Date.now() - t0} ms`);

const stop = setTimeout(async () => { console.log("[spike] listen window over"); await app.stop(); process.exit(0); }, listenSeconds * 1000);
for await (const [space, message] of app.messages) {
  // Read receipts, tapbacks and other non-text events are not replies; log and keep listening.
  if (message.content.type !== "text") { console.log(`[spike] event after ${((Date.now() - t0) / 1000).toFixed(1)} s: (${message.content.type})`); continue; }
  const body = message.content.text;
  console.log(`[spike] inbound after ${((Date.now() - t0) / 1000).toFixed(1)} s: ${body}`);
  await space.responding(async () => { await space.send(text("Got it. Replies work. Thanks.")); });
  clearTimeout(stop);
  await app.stop();
  process.exit(0);
}
