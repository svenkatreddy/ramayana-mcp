import { z } from 'zod';
import { createServer } from './server.js';

// Smithery entrypoint: the TypeScript runtime imports `createServer` and
// `configSchema` from here and hosts the server itself.
export const configSchema = z
  .object({})
  .describe('The Ramayana MCP server needs no configuration');

export { createServer };

// Smithery's deploy validator requires the default export to be a function
// or a server instance, so export the factory as default too.
export default createServer;
