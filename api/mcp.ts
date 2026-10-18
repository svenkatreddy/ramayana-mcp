import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

// Vercel serverless entrypoint: plain stateless JSON-RPC 2.0 over HTTP POST.
//
// SELF-CONTAINED BY DESIGN. Do not import from ../src here: Vercel's function
// bundler mishandles cross-directory TypeScript imports (it crashed at import
// time with FUNCTION_INVOCATION_FAILED while the same code ran fine locally).
// This file therefore inlines the small amount of data/tool logic it needs.
// The canonical implementations live in src/data.ts and src/tooldefs.ts and
// are used by the stdio entrypoint and Smithery - keep this file in sync
// when tools change.

// ---------- data loading (mirrors src/data.ts) ----------

interface VerseTexts {
  sa?: string;
  en?: string;
  hi?: string;
  te?: string;
}

interface KandaData {
  kanda: string;
  sanskritName: string;
  chapters: Record<string, { verses: Record<string, VerseTexts> }>;
}

interface Manifest {
  kandas: Array<{
    kanda: string;
    sanskritName: string;
    chapters: Array<{ chapter: number; verses: number }>;
  }>;
  totalVerses: number;
}

function dataDir(): string {
  return process.env.RAMAYANA_DATA_DIR ?? path.join(process.cwd(), 'data');
}

let manifestCache: Manifest | null = null;
function getManifest(): Manifest {
  if (!manifestCache) {
    manifestCache = JSON.parse(readFileSync(path.join(dataDir(), 'manifest.json'), 'utf8')) as Manifest;
  }
  return manifestCache;
}

const kandaCache = new Map<string, KandaData>();
function getKanda(kanda: string): KandaData {
  const hit = kandaCache.get(kanda);
  if (hit) return hit;
  const file = path.join(dataDir(), 'kandas', `${kanda}.json`);
  if (!existsSync(file)) throw new Error(`Unknown kanda: ${kanda}`);
  const data = JSON.parse(readFileSync(file, 'utf8')) as KandaData;
  kandaCache.set(kanda, data);
  return data;
}

function verseNumbers(kanda: string, chapter: number): string[] {
  const ch = getKanda(kanda).chapters[String(chapter)];
  if (!ch) throw new Error(`Unknown chapter: ${kanda} chapter ${chapter}`);
  return Object.keys(ch.verses).sort((a, b) => Number(a) - Number(b));
}

interface ResolvedVerse {
  kanda: string;
  chapter: number;
  verse: string;
  texts: VerseTexts;
}

function getVerse(kanda: string, chapter: number, verse: string | number): ResolvedVerse {
  const key = String(verse);
  const ch = getKanda(kanda).chapters[String(chapter)];
  if (!ch) throw new Error(`Unknown chapter: ${kanda} chapter ${chapter}`);
  const texts = ch.verses[key];
  if (!texts) throw new Error(`Verse not found: ${kanda} ${chapter}.${verse}`);
  return { kanda, chapter, verse: key, texts };
}

function hashToIndex(seed: string, total: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % total;
}

function verseOfTheDay(dateStr?: string) {
  const day = dateStr ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('date must be YYYY-MM-DD');
  const manifest = getManifest();
  let idx = hashToIndex(`ramayana-votd:${day}`, manifest.totalVerses);
  for (const k of manifest.kandas) {
    for (const ch of k.chapters) {
      if (idx < ch.verses) {
        const nums = verseNumbers(k.kanda, ch.chapter);
        const verseKey = nums[idx];
        const texts = getKanda(k.kanda).chapters[String(ch.chapter)].verses[verseKey];
        return { date: day, kanda: k.kanda, chapter: ch.chapter, verse: verseKey, texts };
      }
      idx -= ch.verses;
    }
  }
  throw new Error('verse index out of range');
}

interface SearchHit {
  kanda: string;
  chapter: number;
  verse: string;
  matched: Array<'sa' | 'en' | 'hi' | 'te'>;
  snippet: string;
}

function searchVerses(query: string, limit = 10): SearchHit[] {
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
          const snippet = first.slice(Math.max(0, pos - 60), pos + 140).replace(/\s+/g, ' ');
          hits.push({ kanda: k.kanda, chapter: Number(chNum), verse: vNum, matched: [...matched], snippet });
          if (hits.length >= limit) return hits;
        }
      }
    }
  }
  return hits;
}

// ---------- tools (mirrors src/tooldefs.ts) ----------

const LANG_LABELS: Record<string, string> = {
  sa: 'Sanskrit',
  en: 'English',
  hi: 'Hindi',
  te: 'Telugu',
};

function formatVerse(v: ResolvedVerse): string {
  const lines = [`${v.kanda} ${v.chapter}.${v.verse}`];
  for (const l of ['sa', 'en', 'hi', 'te'] as const) {
    if (v.texts[l]) lines.push(`[${LANG_LABELS[l]}] ${v.texts[l]}`);
  }
  return lines.join('\n');
}

function reqStr(v: unknown, name: string): string {
  if (typeof v !== 'string' || v.length === 0) throw new Error(`Missing required parameter: ${name}`);
  return v;
}

function reqInt(v: unknown, name: string, min = 1): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n) || n < min) throw new Error(`Invalid integer parameter: ${name}`);
  return n;
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  call: (args: Record<string, unknown>) => Promise<string>;
}

const TOOL_DEFS: ToolDef[] = [
  {
    name: 'list_kandas',
    description: 'List the seven kandas of the Ramayana with their Sanskrit names and chapter counts',
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    call: async () => {
      const m = getManifest();
      return m.kandas.map((k) => `${k.kanda} (${k.sanskritName}): ${k.chapters.length} chapters`).join('\n');
    },
  },
  {
    name: 'get_verse',
    description: 'Fetch a single verse by kanda, chapter (sarga) and verse number, with Sanskrit and available translations',
    inputSchema: {
      type: 'object',
      properties: {
        kanda: { type: 'string', description: 'Kanda name, e.g. bala_kanda' },
        chapter: { type: 'integer', description: 'Sarga (chapter) number', minimum: 1 },
        verse: { type: 'integer', description: 'Verse number within the sarga', minimum: 1 },
      },
      required: ['kanda', 'chapter', 'verse'],
      additionalProperties: false,
    },
    call: async (a) =>
      formatVerse(getVerse(reqStr(a.kanda, 'kanda'), reqInt(a.chapter, 'chapter'), reqInt(a.verse, 'verse'))),
  },
  {
    name: 'get_sarga',
    description: 'Fetch every verse of one sarga (chapter), with Sanskrit and available translations',
    inputSchema: {
      type: 'object',
      properties: {
        kanda: { type: 'string', description: 'Kanda name, e.g. ayodhya_kanda' },
        chapter: { type: 'integer', description: 'Sarga (chapter) number', minimum: 1 },
        langs: {
          type: 'array',
          description: 'Languages to include; defaults to all available',
          items: { type: 'string', enum: ['sa', 'en', 'hi', 'te'] },
        },
      },
      required: ['kanda', 'chapter'],
      additionalProperties: false,
    },
    call: async (a) => {
      const kanda = reqStr(a.kanda, 'kanda');
      const chapter = reqInt(a.chapter, 'chapter');
      const langs = (
        Array.isArray(a.langs) && a.langs.length > 0 ? a.langs : ['sa', 'en', 'hi', 'te']
      ) as Array<'sa' | 'en' | 'hi' | 'te'>;
      return verseNumbers(kanda, chapter)
        .map((n) => {
          const v = getVerse(kanda, chapter, n);
          const lines = [`${v.kanda} ${v.chapter}.${v.verse}`];
          for (const l of langs) if (v.texts[l]) lines.push(`[${LANG_LABELS[l]}] ${v.texts[l]}`);
          return lines.join('\n');
        })
        .join('\n\n');
    },
  },
  {
    name: 'search_verses',
    description: 'Full-text search across Sanskrit and English/Hindi/Telugu translations; returns matching verse references with snippets',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search text, e.g. a name, phrase or Sanskrit word', minLength: 2 },
        limit: { type: 'integer', description: 'Max results (default 10)', minimum: 1, maximum: 50 },
      },
      required: ['query'],
      additionalProperties: false,
    },
    call: async (a) => {
      const query = reqStr(a.query, 'query');
      if (query.length < 2) throw new Error('query must be at least 2 characters');
      const limit = a.limit === undefined ? 10 : Math.min(reqInt(a.limit, 'limit', 1), 50);
      const hits = searchVerses(query, limit);
      if (hits.length === 0) return `No verses match "${query}".`;
      return hits
        .map(
          (h) =>
            `${h.kanda} ${h.chapter}.${h.verse} [${h.matched.map((m) => LANG_LABELS[m]).join(', ')}]\n${h.snippet}...`,
        )
        .join('\n\n');
    },
  },
  {
    name: 'verse_of_the_day',
    description: 'A deterministic verse of the day: the same calendar date always yields the same verse, drawn uniformly from the whole corpus',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Date as YYYY-MM-DD; defaults to today (UTC)' },
      },
      required: [],
      additionalProperties: false,
    },
    call: async (a) => {
      const v = verseOfTheDay(a.date === undefined ? undefined : reqStr(a.date, 'date'));
      return `Verse of the day for ${v.date}\n${formatVerse(v)}`;
    },
  },
];

// ---------- JSON-RPC dispatcher ----------

const SERVER_INFO = { name: 'ramayana-book', version: '0.1.0' };
const SUPPORTED_PROTOCOLS = ['2024-11-05', '2025-03-26', '2025-06-18'];

const ok = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result });
const err = (id: unknown, code: number, message: string) => ({
  jsonrpc: '2.0',
  id,
  error: { code, message },
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json(err(null, -32600, 'Use POST with a JSON-RPC MCP request body'));
    return;
  }
  const msg = req.body as { id?: unknown; method?: string; params?: any } | undefined;
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
    res.status(400).json(err(null, -32700, 'Invalid JSON-RPC payload'));
    return;
  }
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  try {
    let result: unknown;
    switch (method) {
      case 'initialize': {
        const pv = params?.protocolVersion;
        result = {
          protocolVersion: SUPPORTED_PROTOCOLS.includes(pv) ? pv : '2024-11-05',
          capabilities: { tools: {}, resources: {} },
          serverInfo: SERVER_INFO,
        };
        break;
      }
      case 'ping':
        result = {};
        break;
      case 'notifications/initialized':
        res.status(202).end();
        return;
      case 'tools/list':
        result = {
          tools: TOOL_DEFS.map((d) => ({
            name: d.name,
            description: d.description,
            inputSchema: d.inputSchema,
          })),
        };
        break;
      case 'tools/call': {
        const def = TOOL_DEFS.find((d) => d.name === params?.name);
        if (!def) {
          res.status(200).json(err(id ?? null, -32602, `Unknown tool: ${params?.name}`));
          return;
        }
        try {
          const text = await def.call(params?.arguments ?? {});
          result = { content: [{ type: 'text', text }] };
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);
          result = { content: [{ type: 'text', text: `Error: ${m}` }], isError: true };
        }
        break;
      }
      case 'resources/list':
        result = {
          resources: [
            {
              uri: 'ramayana://kandas',
              name: 'kanda-index',
              description: 'Kanda names, Sanskrit titles and chapter/verse counts',
              mimeType: 'application/json',
            },
          ],
        };
        break;
      case 'resources/read': {
        const uri = params?.uri;
        if (uri !== 'ramayana://kandas') {
          res.status(200).json(err(id ?? null, -32602, `Unknown resource: ${uri}`));
          return;
        }
        result = {
          contents: [
            { uri, mimeType: 'application/json', text: JSON.stringify(getManifest(), null, 2) },
          ],
        };
        break;
      }
      default:
        res.status(200).json(err(id ?? null, -32601, `Method not found: ${method}`));
        return;
    }
    if (isNotification) {
      res.status(202).end();
      return;
    }
    res.status(200).json(ok(id, result));
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (!res.headersSent) res.status(200).json(err(id ?? null, -32603, m));
  }
}
