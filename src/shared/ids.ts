/**
 * MERQO ID generation — ULID (Universally Unique Lexicographically Sortable
 * Identifier). 126 bits → 26-char Crockford base32:
 *   48-bit timestamp (ms) = 10 chars, 80-bit randomness = 16 chars.
 * Sortable by creation time, URL-safe, collision-safe for local use.
 */
import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function base32Encode(bytes: number[]): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

export function generateId(now: number = Date.now()): string {
  const buf = new Uint8Array(16);
  // 48-bit big-endian timestamp in the first 6 bytes
  let ts = now;
  for (let i = 5; i >= 0; i--) {
    buf[i] = ts & 0xff;
    ts = Math.floor(ts / 256);
  }
  const rand = randomBytes(10);
  for (let i = 0; i < 10; i++) buf[6 + i] = rand[i];
  return base32Encode(Array.from(buf));
}

export function isValidId(id: unknown): id is string {
  return typeof id === 'string' && /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(id);
}
