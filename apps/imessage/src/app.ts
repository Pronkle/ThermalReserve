// Wires the mirror, watcher, concierge and transport together. Both entrypoints call runCompanion.
import { join } from 'node:path';
import { loadChatConstants, loadConfig, maskAddress, type ChatConfig } from './config';
import { handleInbound } from './concierge/inbound';
import { Store } from './memory/store';
import { Mirror } from './stdb/mirror';
import type { Transport } from './transport/spectrum';
import { Notifier } from './watcher/notifier';

export async function runCompanion(transport: Transport, config: ChatConfig = loadConfig()) {
  const log = (line: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${line}`);
  const consts = loadChatConstants();
  const store = new Store(join(config.dataDir, `chat-${config.stdbDb}.sqlite`));
  const settled = store.settleInterruptedSends(Date.now());
  if (settled.length) log(`[outbox] ${settled.length} send(s) interrupted by the last shutdown counted as sent (never re-sent)`);
  log(`[chat] database ${config.stdbDb}; demo mode ${config.demo ? 'on' : 'off'}; throttle ${config.throttleMs / 1000} s; ${store.contacts().length} linked contact(s)`);

  // Forget contacts whose household is gone (reset_households or a new database).
  const sweep = () => {
    const live = new Set(mirror.households().map(h => h.identity));
    for (const c of store.contacts()) {
      if (!live.has(c.identity)) {
        store.forget(c.address);
        log(`[link] ${maskAddress(c.address)}: household ${c.nickname} removed; contact and memory deleted`);
      }
    }
  };

  const mirror: Mirror = new Mirror(config, {
    onChange: () => notifier.observe(),
    onHouseholdRemoved: () => sweep(),
    onReady: () => sweep(),
    log,
  });
  const notifier = new Notifier({
    store, config, consts,
    household: id => mirror.household(id),
    sim: () => mirror.sim(),
    sendText: (address, body) => transport.sendText(address, body),
    log,
  });
  mirror.connect();
  const timer = setInterval(() => { if (mirror.isReady) void notifier.flush(); }, 500);

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log(`[chat] ${signal}: stopping`);
    clearInterval(timer);
    mirror.disconnect();
    await transport.stop().catch(() => undefined);
    store.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  for await (const msg of transport.inbound()) {
    try {
      // A text that arrives during startup waits for the live data (link codes, current state).
      if (!(await mirror.whenReady())) log('[in] live data not ready after 10 s; answering anyway');
      const reply = await handleInbound({
        store, consts,
        households: () => mirror.households(),
        sim: () => mirror.sim(),
        log,
      }, msg.address, msg.text);
      log(`[in] ${maskAddress(msg.address)}: ${reply.react ? `tapback ${reply.react}` : `${reply.texts.length} bubble(s)`}`);
      if (reply.react) await msg.react(reply.react);
      if (reply.texts.length) await msg.responding(async () => { for (const t of reply.texts) await msg.send(t); });
    } catch (e) {
      log(`[in] ${maskAddress(msg.address)} handler error: ${String(e)}`);
    }
  }
  await shutdown('inbound stream ended');
}
