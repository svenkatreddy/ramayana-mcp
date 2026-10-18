import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  getManifest,
  getVerse,
  getKanda,
  verseNumbers,
  searchVerses,
  verseOfTheDay,
  type ResolvedVerse,
} from './data.js';

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

function text(t: string) {
  return { content: [{ type: 'text' as const, text: t }] };
}

function err(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
}

export function createServer(): McpServer {
  const server = new McpServer({ name: 'ramayana-book', version: '0.1.0' });

  server.tool(
    'list_kandas',
    'List the seven kandas of the Ramayana with their Sanskrit names and chapter counts',
    {},
    async () => {
      try {
        const m = getManifest();
        const lines = m.kandas.map(
          (k) => `${k.kanda} (${k.sanskritName}): ${k.chapters.length} chapters`,
        );
        return text(lines.join('\n'));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    'get_verse',
    'Fetch a single verse by kanda, chapter (sarga) and verse number, with Sanskrit and available translations',
    {
      kanda: z.string().describe('Kanda name, e.g. bala_kanda'),
      chapter: z.number().int().positive().describe('Sarga (chapter) number'),
      verse: z.number().int().positive().describe('Verse number within the sarga'),
    },
    async ({ kanda, chapter, verse }) => {
      try {
        return text(formatVerse(getVerse(kanda, chapter, verse)));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    'get_sarga',
    'Fetch every verse of one sarga (chapter), with Sanskrit and available translations',
    {
      kanda: z.string().describe('Kanda name, e.g. ayodhya_kanda'),
      chapter: z.number().int().positive().describe('Sarga (chapter) number'),
      langs: z
        .array(z.enum(['sa', 'en', 'hi', 'te']))
        .optional()
        .describe('Languages to include; defaults to all available'),
    },
    async ({ kanda, chapter, langs }) => {
      try {
        const nums = verseNumbers(kanda, chapter);
        const blocks = nums.map((n) => {
          const v = getVerse(kanda, chapter, n);
          const lines = [`${v.kanda} ${v.chapter}.${v.verse}`];
          for (const l of (langs ?? ['sa', 'en', 'hi', 'te']) as Array<'sa' | 'en' | 'hi' | 'te'>) {
            if (v.texts[l]) lines.push(`[${LANG_LABELS[l]}] ${v.texts[l]}`);
          }
          return lines.join('\n');
        });
        return text(blocks.join('\n\n'));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    'search_verses',
    'Full-text search across Sanskrit and English/Hindi/Telugu translations; returns matching verse references with snippets',
    {
      query: z.string().min(2).describe('Search text, e.g. a name, phrase or Sanskrit word'),
      limit: z.number().int().min(1).max(50).optional().describe('Max results (default 10)'),
    },
    async ({ query, limit }) => {
      try {
        const hits = searchVerses(query, limit ?? 10);
        if (hits.length === 0) return text(`No verses match "${query}".`);
        const lines = hits.map(
          (h) =>
            `${h.kanda} ${h.chapter}.${h.verse} [${h.matched.map((m) => LANG_LABELS[m]).join(', ')}]\n${h.snippet}...`,
        );
        return text(lines.join('\n\n'));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    'verse_of_the_day',
    'A deterministic verse of the day: the same calendar date always yields the same verse, drawn uniformly from the whole corpus',
    {
      date: z
        .string()
        .optional()
        .describe('Date as YYYY-MM-DD; defaults to today (UTC)'),
    },
    async ({ date }) => {
      try {
        const v = verseOfTheDay(date);
        return text(`Verse of the day for ${v.date}\n${formatVerse(v)}`);
      } catch (e) {
        return err(e);
      }
    },
  );

  // Also expose the index as a resource so clients can browse kanda metadata.
  server.resource(
    'kanda-index',
    'ramayana://kandas',
    { description: 'Kanda names, Sanskrit titles and chapter/verse counts' },
    async (uri) => {
      const m = getManifest();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(m, null, 2),
          },
        ],
      };
    },
  );

  return server;
}
