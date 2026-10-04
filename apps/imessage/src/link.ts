// Short household codes: first 6 characters of base32(SHA-256(identity hex)). No longer used
// for linking (H3, Oct 4: START/STOP only); still names the placeholder email Photon requires.
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
