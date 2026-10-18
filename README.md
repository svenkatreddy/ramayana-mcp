# ramayana-mcp

An MCP (Model Context Protocol) server for the Ramayana Book
([svenkatreddy/ramayana-mcp](https://github.com/svenkatreddy/ramayana-mcp)).
Search verses,
fetch Sanskrit plus English/Hindi/Telugu translations, and get a deterministic
verse of the day. Same codebase serves three targets:

- **stdio** (`src/stdio.ts`) — Claude Desktop, Cursor, and Smithery hosting
- **Vercel serverless** (`api/mcp.ts`) — stateless Streamable HTTP at `/api/mcp`

## Tools

| Tool | What it does |
|---|---|
| `list_kandas` | The seven kandas with Sanskrit titles and chapter counts |
| `get_verse` | One verse by kanda, sarga and verse number |
| `get_sarga` | Every verse of one sarga, optional language filter |
| `search_verses` | Full-text search across all four languages, with snippets |
| `verse_of_the_day` | Deterministic verse of the day (see below) |

Plus a `ramayana://kandas` resource with kanda/chapter/verse counts.

## Verse of the day

`verse_of_the_day` hashes the calendar date (FNV-1a, `YYYY-MM-DD`, UTC by
default) and maps it uniformly onto all 24,214 indexed verses. The same date
always returns the same verse; pass an explicit `date` to look up any other day.

## Local setup

```bash
npm install
npm run build-index   # builds data/ from a Ramayana_Book checkout
npm run build
npm start             # stdio server
```

`build-index` reads the Ramayana_Book repo from `RAMAYANA_BOOK_DIR`
(default: `../../ramayana-modernization/repo` relative to this package).

Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "ramayana-book": {
      "command": "node",
      "args": ["/absolute/path/to/ramayana-mcp/dist/src/stdio.js"]
    }
  }
}
```

## Deploy on Vercel (free Hobby plan, no payment needed)

1. Push this directory to a new GitHub repo (create the repo yourself on github.com).
2. In the Vercel dashboard: Add New Project -> Import the repo -> Deploy.
3. No build config needed; `vercel.json` already ships the `data/` files with
   the function. The MCP endpoint is `https://<project>.vercel.app/api/mcp`.

The endpoint is stateless (one POST per JSON-RPC request, no sessions), which
fits the Hobby plan's function limits. Point any MCP client at the URL above.

## Publish on Smithery (for discoverability)

1. Push the repo to GitHub (public) - done: `svenkatreddy/ramayana-mcp`.
2. Go to [smithery.ai](https://smithery.ai), sign in with GitHub.
3. Add / deploy the `ramayana-mcp` repo. `smithery.yaml` declares the
   TypeScript runtime; Smithery installs, builds, and imports `createServer`
   plus `configSchema` from `src/index.ts`. No API keys or config needed.

Smithery hosts the server and gives it a registry page with one-click
install for Claude Desktop, Cursor, and other clients.

## Data and attribution

Verse data is built from the Ramayana_Book repository:

- Sanskrit: Sanskrit Wikisource (Wikimedia); 3 chapters restored from IIT Kanpur's critical edition
- English: Valmiki Ramayan Dataset (MIT) — M.N. Dutt's translation (1891-1894), IIT Kanpur, Gyaandweep
- Hindi: Chaturvedi Dwarka Prasad Sharma's Hindi Ramayana (used with permission)
- Telugu: Telugu Wikisource contributors (CC BY-SA)

Re-run `npm run build-index` after the Ramayana_Book translations change.

## License

The server code in this repo is MIT licensed (see [LICENSE](LICENSE)).

The verse data under `data/` carries the licenses of its sources, not MIT:
Sanskrit from Sanskrit Wikisource (Wikimedia), English from the MIT-licensed
Valmiki Ramayan Dataset, Hindi from Chaturvedi Dwarka Prasad Sharma's
translation (used with permission), Telugu from Telugu Wikisource contributors
(CC BY-SA). See the Ramayana_Book
[translation sources](https://github.com/svenkatreddy/Ramayana_Book) for full
attribution.
