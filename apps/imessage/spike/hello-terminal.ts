// Phase 0 spike: echo agent on the Spectrum terminal provider (no credentials).
import { Spectrum, text } from "spectrum-ts";
import { terminal } from "spectrum-ts/providers/terminal";

const app = await Spectrum({ providers: [terminal.config()], telemetry: false });
console.error("[spike] spectrum up");

for await (const [space, message] of app.messages) {
  const body = message.content.type === "text" ? message.content.text : `(${message.content.type})`;
  console.error(`[spike] inbound from ${message.sender?.id ?? "?"}: ${body}`);
  await space.responding(async () => {
    await space.send(text(`Thermal Reserve demo heard: ${body}`));
  });
  if (body.trim().toLowerCase() === "bye") break;
}
await app.stop();
console.error("[spike] stopped");
