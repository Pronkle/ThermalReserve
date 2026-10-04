// Link codes (CHAT brief §5.1 design A): first 6 characters of base32(SHA-256(identity hex)).
// /home and the concierge compute the same code from the public household identity.
import { createHash } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

export function linkCode(identityHex: string): string {
  const hex = identityHex.toLowerCase().replace(/^0x/, '');
  return base32(createHash('sha256').update(hex, 'utf8').digest()).slice(0, 6);
}

// "Link my home K7Q2MX", "link k7q2mx", "LINK K7Q2MX please" → "K7Q2MX".
export function parseLinkCode(text: string): string | undefined {
  const match = /\blink\b(?:\s+my\s+home)?\s*:?\s*([a-z2-7]{6})\b/i.exec(text);
  return match ? match[1].toUpperCase() : undefined;
}
