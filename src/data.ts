import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export interface VerseTexts {
  sa?: string;
  en?: string;
  hi?: string;
  te?: string;
}

export interface KandaData {
  kanda: string;
  sanskritName: string;
  chapters: Record<string, { verses: Record<string, VerseTexts> }>;
}

export interface ManifestChapter {
  chapter: number;
  verses: number;
}

export interface ManifestKanda {
  kanda: string;
  sanskritName: string;
  chapters: ManifestChapter[];
}

export interface Manifest {
  kandas: ManifestKanda[];
  totalVerses: number;
}

function dataDir(): string {
  return process.env.RAMAYANA_DATA_DIR ?? path.join(process.cwd(), 'data');
}

let manifestCache: Manifest | null = null;

export function getManifest(): Manifest {
  if (!manifestCache) {
    manifestCache = JSON.parse(
      readFileSync(path.join(dataDir(), 'manifest.json'), 'utf8'),
    ) as Manifest;
  }
  return manifestCache;
}

const kandaCache = new Map<string, KandaData>();

export function getKanda(kanda: string): KandaData {
  const hit = kandaCache.get(kanda);
  if (hit) return hit;
  const file = path.join(dataDir(), 'kandas', `${kanda}.json`);
  if (!existsSync(file)) throw new Error(`Unknown kanda: ${kanda}`);
  const data = JSON.parse(readFileSync(file, 'utf8')) as KandaData;
  kandaCache.set(kanda, data);
  return data;
}

export function verseNumbers(kanda: string, chapter: number): string[] {
  const ch = getKanda(kanda).chapters[String(chapter)];
  if (!ch) throw new Error(`Unknown chapter: ${kanda} chapter ${chapter}`);
  return Object.keys(ch.verses).sort((a, b) => Number(a) - Number(b));
}

export interface ResolvedVerse {
  kanda: string;
  chapter: number;
  verse: string;
  texts: VerseTexts;
}

export function getVerse(
  kanda: string,
  chapter: number,
  verse: string | number,
): ResolvedVerse {
  const key = String(verse);
  const ch = getKanda(kanda).chapters[String(chapter)];
  if (!ch) throw new Error(`Unknown chapter: ${kanda} chapter ${chapter}`);
  const texts = ch.verses[key];
  if (!texts) {
    throw new Error(
      `Verse not found: ${kanda} ${chapter}.${verse} (chapter has ${Object.keys(ch.verses).length} verses)`,
    );
  }
  return { kanda, chapter, verse: key, texts };
}

// FNV-1a 32-bit hash, mapped into [0, total).
function hashToIndex(seed: string, total: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % total;
}

export interface VerseOfTheDay extends ResolvedVerse {
  date: string;
  sanskritName: string;
}

// Deterministic verse of the day: the same date always yields the same verse,
// drawn uniformly from every verse in the corpus.
export function verseOfTheDay(dateStr?: string): VerseOfTheDay {
  const day = dateStr ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error('date must be YYYY-MM-DD');
  }
  const manifest = getManifest();
  let idx = hashToIndex(`ramayana-votd:${day}`, manifest.totalVerses);
  for (const k of manifest.kandas) {
    for (const ch of k.chapters) {
      if (idx < ch.verses) {
        const nums = verseNumbers(k.kanda, ch.chapter);
        const verseKey = nums[idx];
        const texts = getKanda(k.kanda).chapters[String(ch.chapter)].verses[verseKey];
        return {
          date: day,
          kanda: k.kanda,
          sanskritName: k.sanskritName,
          chapter: ch.chapter,
          verse: verseKey,
          texts,
        };
      }
      idx -= ch.verses;
    }
  }
  throw new Error('verse index out of range');
}

export interface SearchHit {
  kanda: string;
  chapter: number;
  verse: string;
  matched: Array<'sa' | 'en' | 'hi' | 'te'>;
  snippet: string;
}

export function searchVerses(query: string, limit = 10): SearchHit[] {
  const q = query.toLowerCase();
  const hits: SearchHit[] = [];
  for (const k of getManifest().kandas) {
    const data = getKanda(k.kanda);
    for (const [chNum, ch] of Object.entries(data.chapters)) {
      for (const [vNum, texts] of Object.entries(ch.verses)) {
        const matched = (['sa', 'en', 'hi', 'te'] as const).filter((l) =>
          texts[l]?.toLowerCase().includes(q),
        );
        if (matched.length > 0) {
          const first = texts[matched[0]] ?? '';
          const pos = first.toLowerCase().indexOf(q);
          const snippet = first
            .slice(Math.max(0, pos - 60), pos + 140)
            .replace(/\s+/g, ' ');
          hits.push({
            kanda: k.kanda,
            chapter: Number(chNum),
            verse: vNum,
            matched: [...matched],
            snippet,
          });
          if (hits.length >= limit) return hits;
        }
      }
    }
  }
  return hits;
}
