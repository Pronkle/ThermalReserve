// Wires the mirror, watcher, concierge and transport together. Both entrypoints call runCompanion.
import { join } from 'node:path';
import { loadChatConstants, loadConfig, maskAddress, type ChatConfig } from './config';
import Anthropic from '@anthropic-ai/sdk';
import { converse, fallbackReply } from './concierge/agent';
import { classify, handleInbound } from './concierge/inbound';
import type { ModelCall } from './insights/agent';
import { linkCode } from './link';
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

  // Photon's shared line only routes a person's texts to us for a while after we last texted
  // them (observed Oct 4). For the demo phone, one hello at startup opens that window.
  if (config.helloTo) {
    void mirror.whenReady().then(async () => {
      const homes = mirror.households();
      const linked = store.contact(config.helloTo!);
      const only = homes.length === 1 ? ` For ${homes[0].nickname}, that's Link my home ${linkCode(homes[0].identity)}.` : '';
      const body = linked
        ? `Thermal Reserve demo assistant is back on (simulation only). You're linked to ${linked.nickname}.`
        : `Thermal Reserve demo assistant is on (simulation only). To get heat updates, text Link my home and your code from the household page.${only}`;
      try {
        await transport.sendText(config.helloTo!, body);
        store.addHistory(config.helloTo!, 'out', body, Date.now());
        log(`[hello] sent to ${maskAddress(config.helloTo!)}`);
      } catch (e) {
        log(`[hello] failed: ${String(e).slice(0, 160)}`);
      }
    });
  }
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

  // Both agents run on Claude Haiku 4.5. Without a key (or if the API fails) the concierge sends
  // an honest deterministic reply instead.
  const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ timeout: 20_000, maxRetries: 1 }) : undefined;
  if (!anthropic) log('[chat] ANTHROPIC_API_KEY not set: questions get the deterministic fallback reply');
  // Haiku 4.5 list prices, for the per-call cost line ($ per million tokens).
  const PRICE = { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 };
  let spentUsd = 0;
  const call: ModelCall = async params => {
    if (!anthropic) throw new Error('ANTHROPIC_API_KEY not set');
    const response = await anthropic.messages.create(params);
    const u = response.usage;
    const usd = (u.input_tokens * PRICE.input + u.output_tokens * PRICE.output
      + (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead + (u.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite) / 1e6;
    spentUsd += usd;
    log(`[usage] ${params.model}: ${u.input_tokens} in, ${u.output_tokens} out, cache read ${u.cache_read_input_tokens ?? 0} → $${usd.toFixed(4)} (session $${spentUsd.toFixed(4)})`);
    return response;
  };
  const converseSafely = async (address: string, identity: string, text: string) => {
    try {
      return (await converse({ store, world: mirror, consts, call, dataDir: config.dataDir, log }, address, identity, text)).bubbles;
    } catch (e) {
      const kind = e instanceof Anthropic.APIError ? `API ${e.status ?? 'connection'} error` : String(e).slice(0, 120);
      log(`[concierge] model unavailable (${kind}); deterministic reply`);
      return [fallbackReply({ world: mirror, consts }, identity, text)];
    }
  };

  for await (const msg of transport.inbound()) {
    try {
      // A text that arrives during startup waits for the live data (link codes, current state).
      if (!(await mirror.whenReady())) log('[in] live data not ready after 10 s; answering anyway');
      const deps = { store, consts, households: () => mirror.households(), sim: () => mirror.sim(), log, converse: converseSafely };
      const control = classify(msg.text) !== 'other' || !store.contact(msg.address);
      if (control) {
        const reply = await handleInbound(deps, msg.address, msg.text);
        log(`[in] ${maskAddress(msg.address)}: ${reply.react ? `tapback ${reply.react}` : `${reply.texts.length} bubble(s)`}`);
        if (reply.react) await msg.react(reply.react);
        if (reply.texts.length) await msg.responding(async () => { for (const t of reply.texts) await msg.send(t); });
        continue;
      }
      // A conversation turn: typing indicator while the agents work, and a short holding bubble
      // if the answer takes longer than 8 s, so the chat never goes silent.
      await msg.responding(async () => {
        const slow = setTimeout(() => { void msg.send('Checking the numbers…'); }, 8_000);
        const reply = await handleInbound(deps, msg.address, msg.text).finally(() => clearTimeout(slow));
        log(`[in] ${maskAddress(msg.address)}: ${reply.texts.length} bubble(s)`);
        for (const t of reply.texts) await msg.send(t);
      });
    } catch (e) {
      log(`[in] ${maskAddress(msg.address)} handler error: ${String(e)}`);
    }
  }
  await shutdown('inbound stream ended');
}
