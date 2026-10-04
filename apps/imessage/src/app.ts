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
import { Feed, startViewer } from './viewer';
import { onboard } from './onboard/onboard';
import { cliRunner, photonUsers } from './onboard/photon';
import type { ContactFeedRow } from './stdb/mirror';

export async function runCompanion(transport: Transport, config: ChatConfig = loadConfig()) {
  const feed = new Feed();
  const log = (line: string) => {
    const stamped = `${new Date().toISOString().slice(11, 19)} ${line}`;
    console.log(stamped);
    feed.push(stamped);
  };
  const viewer = startViewer(Number(process.env.CHAT_VIEWER_PORT ?? 8787), config.dataDir, feed, log);
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

  // Auto-onboarding (H3, H1-approved Oct 4): opted-in households from /home are added to Photon
  // and get one opener asking for YES. On with CHAT_ONBOARD=1 and the operator passcode.
  const onboardOn = process.env.CHAT_ONBOARD === '1' && !!process.env.CHAT_OPERATOR_PASSCODE;
  const photon = photonUsers(cliRunner());
  let onboarding = Promise.resolve();
  const enqueueOnboard = (row: ContactFeedRow) => {
    onboarding = onboarding.then(async () => {
      const result = await onboard({
        store, consts, photon, household: id => mirror.household(id), sim: () => mirror.sim(),
        sendText: (address, body) => transport.sendText(address, body), log,
      }, row);
      if (result !== 'already linked') log(`[onboard] ${maskAddress(row.phone)}: ${result}`);
    }).catch(e => log(`[onboard] error: ${String(e).slice(0, 160)}`));
  };

  const mirror: Mirror = new Mirror(config, {
    onChange: () => notifier.observe(),
    onHouseholdRemoved: () => sweep(),
    onReady: () => {
      sweep();
      if (onboardOn) for (const row of mirror.contactFeed()) enqueueOnboard(row);
    },
    onContact: row => { if (onboardOn) enqueueOnboard(row); },
    // Opting out on /home (clear_contact) deletes what we stored for that number.
    onContactCleared: row => {
      if (store.contact(row.phone)) { store.forget(row.phone); log(`[onboard] ${maskAddress(row.phone)} cleared on /home; contact and memory deleted`); }
    },
    log,
  }, onboardOn ? process.env.CHAT_OPERATOR_PASSCODE : undefined);
  if (onboardOn) log('[onboard] on: opted-in households from /home are added to Photon and sent an opener');
  // Addresses with a reply in progress (Infinity) or just sent (until a time): see Notifier.isBusy.
  const replyingUntil = new Map<string, number>();
  const REPLY_GAP_MS = 5_000;
  const notifier = new Notifier({
    store, config, consts,
    isBusy: address => (replyingUntil.get(address) ?? 0) > Date.now(),
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
      // A returning person gets a nod to what was remembered (persistent context after a restart).
      const lastAsked = linked
        ? store.history(config.helloTo!).filter(t => t.direction === 'in' && classify(t.body) === 'other').at(-1)?.body.trim().slice(0, 80)
        : undefined;
      const body = linked
        ? `Thermal Reserve demo assistant is back on (simulation only). You're linked to ${linked.nickname}.${lastAsked ? ` Last time you asked: "${lastAsked}". Ask me anything about it.` : ''}`
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
    viewer?.close();
    mirror.disconnect();
    await transport.stop().catch(() => undefined);
    store.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // Concierge on Claude Haiku 4.5, Insights on Claude Sonnet 5.5. Without a key (or if the API fails) the concierge sends
  // an honest deterministic reply instead.
  const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ timeout: 20_000, maxRetries: 1 }) : undefined;
  if (!anthropic) log('[chat] ANTHROPIC_API_KEY not set: questions get the deterministic fallback reply');
  // List prices ($ per million tokens) for the per-call cost line.
  const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
    'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
    'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  };
  let spentUsd = 0;
  const call: ModelCall = async params => {
    if (!anthropic) throw new Error('ANTHROPIC_API_KEY not set');
    // Sonnet 5.5 calls opt into server-side refusal fallbacks: a classifier decline is retried
    // on Anthropic's recommended model inside the same call instead of coming back empty.
    const response = params.model === 'claude-sonnet-5-5'
      ? await anthropic.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } as never) as unknown as Anthropic.Message
      : await anthropic.messages.create(params);
    const u = response.usage;
    const price = PRICES[response.model] ?? PRICES[params.model] ?? PRICES['claude-sonnet-5-5'];
    const usd = (u.input_tokens * price.input + u.output_tokens * price.output
      + (u.cache_read_input_tokens ?? 0) * price.cacheRead + (u.cache_creation_input_tokens ?? 0) * price.cacheWrite) / 1e6;
    spentUsd += usd;
    log(`[usage] ${response.model}: ${u.input_tokens} in, ${u.output_tokens} out, cache read ${u.cache_read_input_tokens ?? 0}, cache write ${u.cache_creation_input_tokens ?? 0} → $${usd.toFixed(4)} (session $${spentUsd.toFixed(4)})`);
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
      const deps = {
        store, consts, households: () => mirror.households(), sim: () => mirror.sim(), log, converse: converseSafely,
        onStop: async (address: string, identity: string) => {
          if (await mirror.removeContact(identity)) log(`[onboard] ${maskAddress(address)} STOP: private contact row deleted`);
        },
      };
      const control = classify(msg.text) !== 'other' || !store.contact(msg.address);
      if (control) {
        const reply = await handleInbound(deps, msg.address, msg.text);
        log(`[in] ${maskAddress(msg.address)}: ${reply.react ? `tapback ${reply.react}` : `${reply.texts.length} bubble(s)`}`);
        if (reply.react) await msg.react(reply.react);
        if (reply.texts.length) await msg.responding(async () => { for (const t of reply.texts) await msg.send(t); });
        // After the first exchange, share our contact card once (Photon's deliverability advice).
        const linkedNow = store.contact(msg.address);
        if (linkedNow && !linkedNow.cardSent && transport.shareContactCard) {
          store.markCardSent(msg.address);
          try { await transport.shareContactCard(msg.address); log(`[card] shared with ${maskAddress(msg.address)}`); }
          catch (e) { log(`[card] not shared: ${String(e).slice(0, 120)}`); }
        }
        continue;
      }
      // A conversation turn: typing indicator while the agents work, and a short holding bubble
      // if the answer takes longer than 8 s, so the chat never goes silent.
      replyingUntil.set(msg.address, Infinity);
      try {
        await msg.responding(async () => {
          const slow = setTimeout(() => { void msg.send('Checking the numbers…'); }, 8_000);
          const reply = await handleInbound(deps, msg.address, msg.text).finally(() => clearTimeout(slow));
          log(`[in] ${maskAddress(msg.address)}: ${reply.texts.length} bubble(s)`);
          for (const t of reply.texts) await msg.send(t);
        });
      } finally {
        replyingUntil.set(msg.address, Date.now() + REPLY_GAP_MS);
      }
    } catch (e) {
      log(`[in] ${maskAddress(msg.address)} handler error: ${String(e)}`);
    }
  }
  await shutdown('inbound stream ended');
}
