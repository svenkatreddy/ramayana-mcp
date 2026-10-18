import { z } from 'zod';

// Smithery entrypoint: the TypeScript runtime imports `createServer` and
// `configSchema` from here and hosts the server itself.
export const configSchema = z
  .object({})
  .describe('The Ramayana MCP server needs no configuration');

export { createServer } from './server.js';
