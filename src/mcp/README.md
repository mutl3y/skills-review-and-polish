# MCP Server Seam

This directory contains the headless MCP seam for wrapping the `skills-review-and-polish` engine as an [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server.

## What the MCP seam exposes

The server currently exposes two tools:

- `analyze`: returns diagnostic findings for a full document string and optional file path.
- `fix`: applies the surgical fixer to one flagged issue using the same engine/provider path as the extension.

The server uses the same core engine that powers the VS Code extension, which keeps the analysis behavior consistent across hosts.

## Why this works cleanly

The `src/core/` module is **vscode-free by design** — `src/core/types.ts` has no VS Code imports, and `Engine` only depends on the `LlmProvider` interface. Wrapping it in an MCP server requires:

1. An MCP-compatible transport (e.g. `@modelcontextprotocol/sdk` stdio transport)
2. An `LlmProvider` implementation that calls an external API (already done in `src/providers/externalProvider.ts`)
3. Two MCP tools mirroring the VS Code `languageModelTools`: `analyze` and `fix`

The headless MCP seam now prefers GitHub Models via `GITHUB_TOKEN`, matching the CLI analyzer path. OpenRouter remains available as a fallback when that token is not set.

## Setup and runtime requirements

1. Install dependencies in the repo root:

   ```sh
   npm install
   ```

2. Build the MCP entry point:

   ```sh
   npm run compile
   ```

3. Start the stdio server:

   ```sh
   npm run mcp
   ```

4. Connect it from an MCP client using the `command` / `args` / `env` block shown below.

### Provider selection

The MCP seam prefers GitHub Models via `GITHUB_TOKEN` because that matches the CLI analyzer path in the companion repo. If `GITHUB_TOKEN` is not set, it falls back to `OPENROUTER_API_KEY`.

Recommended env for the headless seam:

```json
{
  "env": {
    "GITHUB_TOKEN": "<your-github-token>",
    "ANALYSIS_MODEL": "gpt-4o-mini"
  }
}
```

Fallback env (if you want to use OpenRouter instead):

```json
{
  "env": {
    "OPENROUTER_API_KEY": "<your-openrouter-key>",
    "ANALYSIS_MODEL": "openai/gpt-4o-mini"
  }
}
```

## Example MCP client config

```json
{
  "mcpServers": {
    "skills-review": {
      "command": "node",
      "args": ["/workspace/skills-review-and-polish/out/mcp/server.js"],
      "env": {
        "GITHUB_TOKEN": "<your-github-token>",
        "ANALYSIS_MODEL": "gpt-4o-mini"
      }
    }
  }
}
```

## To activate

1. Run `npm install` in the repo root.
2. Build the server with `npm run compile`.
3. Start it with `npm run mcp`, or point your MCP client directly at `node ./out/mcp/server.js`.
4. Add the env vars shown above to your client configuration.

   ```json
   {
     "mcpServers": {
       "skills-review": {
         "command": "node",
         "args": ["./out/mcp/server.js"],
         "env": {
           "GITHUB_TOKEN": "<your-github-token>",
           "ANALYSIS_MODEL": "gpt-4o-mini"
         }
       }
     }
   }
   ```

The MCP seam is now wired as a real stdio server entry point. The VS Code language model tools remain the primary in-editor surface, while the MCP path gives headless CI / review-pipeline use-cases a direct engine interface.

## Verification notes

You can verify the seam with any MCP client by calling the `analyze` tool on a sample `SKILL.md` or prompt file. The tool returns JSON diagnostics from the same `Engine` path used by the extension, which makes this a real end-to-end proof path for automation and remote tooling.

### Proof run example

A minimal proof run looks like this:

```sh
cd /workspace/skills-review-and-polish
npm run compile
ANALYSIS_MODEL=gpt-4o-mini node --input-type=module <<'EOF'
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from './out/mcp/server.js';
import { Engine } from './out/core/index.js';
import { GitHubModelsProvider } from './out/providers/externalProvider.js';
import { DEFAULT_ENGINE_CONFIG } from './out/core/types.js';

const skillPath = path.resolve('tests/fixtures/primary/test-ambiguities/SKILL.md');
const text = fs.readFileSync(skillPath, 'utf8');

const buildEngine = async () =>
  new Engine(
    new GitHubModelsProvider({
      apiKey: process.env.GITHUB_TOKEN ?? '',
      model: process.env.ANALYSIS_MODEL ?? 'gpt-4o-mini',
    }),
    { ...DEFAULT_ENGINE_CONFIG, analysisMode: 'single' },
  );

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const server = createMcpServer({ buildEngine });
await server.server.connect(serverTransport);
const client = new Client({ name: 'proof-client', version: '1.0.0' });
await client.connect(clientTransport);

const result = await client.callTool({
  name: 'analyze',
  arguments: { text, filePath: skillPath },
});

console.log(String(result.content?.[0]?.text ?? ''));
await client.close();
await server.server.close();
EOF
```

This produces a real MCP `analyze` response from the server and is the simplest way to validate the seam end to end.
