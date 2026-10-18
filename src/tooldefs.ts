import {
  getManifest,
  getVerse,
  verseNumbers,
  searchVerses,
  verseOfTheDay,
  type VerseTexts,
} from './data.js';

// Single source of truth for the MCP tools, shared by the SDK-based server
// (stdio / Smithery) and the dependency-free Vercel HTTP handler.

export interface ParamSpec {
  type: 'string' | 'integer' | 'array';
  description: string;
  optional?: boolean;
  minLength?: number;
  min?: number;
  max?: number;
  enum?: string[];
  items?: { type: 'string'; enum?: string[] };
}

export interface ToolDef {
  name: string;
  description: string;
  params: Record<string, ParamSpec>;
  call: (args: Record<string, unknown>) => Promise<string>;
}

const LANG_LABELS: Record<string, string> = {
  sa: 'Sanskrit',
  en: 'English',
  hi: 'Hindi',
  te: 'Telugu',
};

interface VerseLike {
  kanda: string;
  chapter: number;
  verse: string;
  texts: VerseTexts;
}

function formatVerse(v: VerseLike): string {
  const lines = [`${v.kanda} ${v.chapter}.${v.verse}`];
  for (const l of ['sa', 'en', 'hi', 'te'] as const) {
    if (v.texts[l]) lines.push(`[${LANG_LABELS[l]}] ${v.texts[l]}`);
  }
  return lines.join('\n');
}

function reqStr(v: unknown, name: string): string {
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`Missing required parameter: ${name}`);
  }
  return v;
}

function reqInt(v: unknown, name: string, min = 1): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n) || n < min) {
    throw new Error(`Invalid integer parameter: ${name}`);
  }
  return n;
}

export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'list_kandas',
    description:
      'List the seven kandas of the Ramayana with their Sanskrit names and chapter counts',
    params: {},
    call: async () => {
      const m = getManifest();
      return m.kandas
        .map((k) => `${k.kanda} (${k.sanskritName}): ${k.chapters.length} chapters`)
        .join('\n');
    },
  },
  {
    name: 'get_verse',
    description:
      'Fetch a single verse by kanda, chapter (sarga) and verse number, with Sanskrit and available translations',
    params: {
      kanda: { type: 'string', description: 'Kanda name, e.g. bala_kanda' },
      chapter: { type: 'integer', description: 'Sarga (chapter) number', min: 1 },
      verse: { type: 'integer', description: 'Verse number within the sarga', min: 1 },
    },
    call: async (a) =>
      formatVerse(
        getVerse(reqStr(a.kanda, 'kanda'), reqInt(a.chapter, 'chapter'), reqInt(a.verse, 'verse')),
      ),
  },
  {
    name: 'get_sarga',
    description:
      'Fetch every verse of one sarga (chapter), with Sanskrit and available translations',
    params: {
      kanda: { type: 'string', description: 'Kanda name, e.g. ayodhya_kanda' },
      chapter: { type: 'integer', description: 'Sarga (chapter) number', min: 1 },
      langs: {
        type: 'array',
        description: 'Languages to include; defaults to all available',
        optional: true,
        items: { type: 'string', enum: ['sa', 'en', 'hi', 'te'] },
      },
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
          for (const l of langs) {
            if (v.texts[l]) lines.push(`[${LANG_LABELS[l]}] ${v.texts[l]}`);
          }
          return lines.join('\n');
        })
        .join('\n\n');
    },
  },
  {
    name: 'search_verses',
    description:
      'Full-text search across Sanskrit and English/Hindi/Telugu translations; returns matching verse references with snippets',
    params: {
      query: {
        type: 'string',
        description: 'Search text, e.g. a name, phrase or Sanskrit word',
        minLength: 2,
      },
      limit: {
        type: 'integer',
        description: 'Max results (default 10)',
        optional: true,
        min: 1,
        max: 50,
      },
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
    description:
      'A deterministic verse of the day: the same calendar date always yields the same verse, drawn uniformly from the whole corpus',
    params: {
      date: {
        type: 'string',
        description: 'Date as YYYY-MM-DD; defaults to today (UTC)',
        optional: true,
      },
    },
    call: async (a) => {
      const v = verseOfTheDay(a.date === undefined ? undefined : reqStr(a.date, 'date'));
      return `Verse of the day for ${v.date}\n${formatVerse(v)}`;
    },
  },
];

export function toolInputSchema(def: ToolDef): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [k, p] of Object.entries(def.params)) {
    const s: Record<string, unknown> = { type: p.type, description: p.description };
    if (p.enum) s.enum = p.enum;
    if (p.items) s.items = p.items;
    if (p.minLength !== undefined) s.minLength = p.minLength;
    if (p.min !== undefined) s.minimum = p.min;
    if (p.max !== undefined) s.maximum = p.max;
    properties[k] = s;
    if (!p.optional) required.push(k);
  }
  return { type: 'object', properties, required, additionalProperties: false };
}
