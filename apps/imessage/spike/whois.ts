// Print (masked) the address and line the SDK resolves for CHAT_TEST_PHONE.
import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
const phone = process.env.CHAT_TEST_PHONE!;
const mask = (s: string) => s.replace(/\d(?=\d{4})/g, "•");
const app = await Spectrum({ providers: [imessage.config()], telemetry: false, options: { logLevel: "warn" } });
const cfg = (app as any).config;
console.log("project slug:", cfg?.slug, "| imessageSynced:", cfg?.profile?.imessageSynced);
const im = imessage(app);
const user = await im.user(phone);
console.log("user:", mask(JSON.stringify(user, (_k, v) => (typeof v === "function" ? undefined : v))));
const dm = await im.space.create(user);
console.log("space id:", mask(String((dm as any).id)), "| line:", mask(String((dm as any).phone)), "| type:", (dm as any).type);
await app.stop();
