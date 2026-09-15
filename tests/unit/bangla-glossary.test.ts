/**
 * Bangla glossary regression guard — docs/BANGLA_GLOSSARY.md §7.
 *
 * The glossary is not merely documentation: if a rejected term reappears
 * in UI source, this test fails the build. Add new rejected terms to
 * REJECTED whenever the glossary canon changes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const RENDERER = path.resolve(__dirname, '../../src/renderer');

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...collectFiles(p));
    else if (p.endsWith('.tsx') || p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Term → canonical replacement. Any occurrence in src/renderer fails the build. */
const REJECTED: { term: string; note: string }[] = [
  { term: 'মজুদ', note: 'canonical: স্টক' },
  { term: 'গ্রাহক', note: 'canonical: কাস্টমার' },
  { term: 'সরবরাহকারী', note: 'canonical: সাপ্লায়ার' },
  { term: 'রিটার্ন', note: 'canonical: ফেরত' },
  { term: 'আপডেট', note: 'canonical: হালনাগাদ' },
  { term: 'আমদানি', note: 'canonical: ইমপোর্ট' },
  { term: 'রপ্তানি', note: 'canonical: এক্সপোর্ট' },
  { term: 'শেষ স্টক', note: 'canonical: স্টক শেষ' },
  { term: 'একশন', note: 'typo — canonical: অ্যাকশন' },
  { term: 'ভ্যালিডেশন', note: 'canonical: যাচাই' },
  { term: 'পুনঃ', note: 'canonical: পুনরায়' },
  { term: 'ক্যান্সেল', note: 'canonical: বাতিল' },
  { term: 'ডিলিট', note: 'canonical: মুছুন' },
  { term: 'এডিট', note: 'canonical: সম্পাদনা' }
];

describe('bangla glossary regression guard', () => {
  it('no rejected term appears anywhere in src/renderer', () => {
    const hits: string[] = [];
    for (const file of collectFiles(RENDERER)) {
      const text = readFileSync(file, 'utf-8');
      for (const { term, note } of REJECTED) {
        if (text.includes(term)) {
          hits.push(`${path.relative(RENDERER, file)}: “${term}” (${note})`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it('glossary.ts still contains the canonical terms', () => {
    const g = readFileSync(path.resolve(__dirname, '../../src/shared/glossary.ts'), 'utf-8');
    for (const t of [
      'বিক্রয়', 'ক্রয়', 'পণ্য', 'স্টক', 'কাস্টমার', 'সাপ্লায়ার',
      'বকেয়া', 'প্রদেয়', 'ফেরত', 'সম্পাদনা', 'বিলগা', 'পুনরুদ্ধার',
      'সাধারণ কাস্টমার', 'আংশিক মোট', 'রেফারেন্স', 'উজড়'
    ]) {
      expect(g, `glossary.ts should contain canonical term: ${t}`).toContain(t);
    }
  });
});
