import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

// stdio entrypoint: used for local use (Claude Desktop) and Smithery hosting.
const server = createServer();
const transport = new StdioServerTransport();
await server.connect(transport);
