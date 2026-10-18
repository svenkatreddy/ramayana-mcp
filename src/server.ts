import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { TOOL_DEFS, type ToolDef } from './tooldefs.js';
import { getManifest } from './data.js';

function toZodShape(def: ToolDef): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [k, p] of Object.entries(def.params)) {
    let t: z.ZodTypeAny;
    if (p.type === 'integer') {
      let n = z.number().int();
      if (p.min !== undefined) n = n.min(p.min);
      if (p.max !== undefined) n = n.max(p.max);
      t = n;
    } else if (p.type === 'array') {
      t = z.array(
        p.items?.enum ? z.enum(p.items.enum as [string, ...string[]]) : z.string(),
      );
    } else {
      let s = z.string();
      if (p.minLength !== undefined) s = s.min(p.minLength);
      t = s;
    }
    if (p.description) t = t.describe(p.description);
    if (p.optional) t = t.optional();
    shape[k] = t;
  }
  return shape;
}

function text(t: string) {
  return { content: [{ type: 'text' as const, text: t }] };
}

export function createServer(): McpServer {
  const server = new McpServer({ name: 'ramayana-book', version: '0.1.0' });

  for (const def of TOOL_DEFS) {
    server.tool(def.name, def.description, toZodShape(def), async (args) => {
      try {
        return text(await def.call(args as Record<string, unknown>));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: 'text' as const, text: `Error: ${msg}` }],
          isError: true,
        };
      }
    });
  }

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
