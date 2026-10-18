import type { VercelRequest, VercelResponse } from '@vercel/node';
import { TOOL_DEFS, toolInputSchema } from '../src/tooldefs.js';
import { getManifest } from '../src/data.js';

// Vercel serverless entrypoint: plain stateless JSON-RPC 2.0 over HTTP POST.
// Deliberately dependency-free (no MCP SDK in this bundle): the SDK's ESM-only
// transport crashes Vercel's function runtime at import time, while this file
// only needs node builtins plus our own data/tool modules.

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
            inputSchema: toolInputSchema(d),
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
