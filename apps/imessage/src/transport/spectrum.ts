// Transport-agnostic wrapper over a Spectrum app: cloud iMessage in production, the terminal
// provider in development. The rest of the code only sees addresses and text.
import { Emoji, text, type Message, type Space, type SpectrumInstance } from 'spectrum-ts';

export interface InboundText {
  address: string;
  text: string;
  react: (kind: 'like' | 'love') => Promise<void>;
  // Runs `fn` with the typing indicator shown.
  responding: (fn: () => Promise<void>) => Promise<void>;
  send: (body: string) => Promise<void>;
}

export interface Transport {
  inbound(): AsyncIterable<InboundText>;
  sendText(address: string, body: string): Promise<void>;
  stop(): Promise<void>;
}

// `openSpace` creates a DM for an address we haven't heard from in this process (cloud iMessage);
// the terminal provider only knows the spaces it has seen.
export function spectrumTransport(
  app: SpectrumInstance,
  openSpace?: (address: string) => Promise<Space>,
): Transport {
  const spaces = new Map<string, Space>();

  async function spaceFor(address: string): Promise<Space> {
    const known = spaces.get(address);
    if (known) return known;
    if (!openSpace) throw new Error('no conversation with this address yet');
    const space = await openSpace(address);
    spaces.set(address, space);
    return space;
  }

  return {
    async *inbound() {
      for await (const [space, message] of app.messages as AsyncIterable<[Space, Message]>) {
        const address = message.sender?.id;
        if (!address || message.direction === 'outbound') continue;
        spaces.set(address, space);
        // Read receipts, tapbacks and attachments are not texts to answer.
        if (message.content.type !== 'text') continue;
        yield {
          address,
          text: message.content.text,
          react: async kind => { await message.react(kind === 'love' ? Emoji.love : Emoji.like); },
          responding: fn => space.responding(fn),
          send: async body => { await space.send(text(body)); },
        };
      }
    },
    async sendText(address, body) {
      const space = await spaceFor(address);
      await space.send(text(body));
    },
    stop: () => app.stop(),
  };
}
