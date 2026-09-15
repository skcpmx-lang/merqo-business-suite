import { describe, it, expect } from 'vitest';
import { generateId, isValidId } from '../../src/shared/ids';

describe('ULID ids', () => {
  it('generates 26-char Crockford base32 ids', () => {
    for (let i = 0; i < 1000; i++) {
      const id = generateId();
      expect(id).toHaveLength(26);
      expect(isValidId(id)).toBe(true);
    }
  });

  it('is sortable by time', () => {
    const a = generateId(1000);
    const b = generateId(2000);
    expect(a < b).toBe(true);
  });

  it('is effectively unique', () => {
    const set = new Set<string>();
    for (let i = 0; i < 20000; i++) set.add(generateId());
    expect(set.size).toBe(20000);
  });
});
