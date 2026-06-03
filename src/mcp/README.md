# MCP Server Seam (Phase 7)

This directory holds the stub/documentation for wrapping the `skills-review-and-polish` engine as an [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server.

## Why this works cleanly

The `src/core/` module is **vscode-free by design** — `src/core/types.ts` has no VS Code imports, and `Engine` only depends on the `LlmProvider` interface. Wrapping it in an MCP server requires:

1. An MCP-compatible transport (e.g. `@modelcontextprotocol/sdk` stdio transport)
2. An `LlmProvider` implementation that calls an external API (already done in `src/providers/externalProvider.ts`)
3. Two MCP tools mirroring the VS Code `languageModelTools`: `analyze` and `fix`

## Minimal stub

```typescript
// src/mcp/server.ts (stub — not compiled with the extension)
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Engine } from '../core/index.js';
import { OpenRouterProvider } from '../providers/externalProvider.js';

const provider = new OpenRouterProvider({
  apiKey: process.env.OPENROUTER_API_KEY ?? '',
  model: process.env.ANALYSIS_MODEL ?? 'openai/gpt-4o-mini',
});
const engine = new Engine(provider);

const server = new Server(
  { name: 'skills-review-and-polish', version: '0.0.1' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler('tools/list', async () => ({
  tools: [
    {
      name: 'analyze',
      description: 'Analyze an AI skill/instructions document for quality issues.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Document content' },
          filePath: { type: 'string', description: 'Optional file path for context' },
        },
        required: ['text'],
      },
    },
    {
      name: 'fix',
      description: 'Surgically fix a single issue in a skill/instructions document.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          filePath: { type: 'string' },
          diagnosticCode: { type: 'string' },
          relevantText: { type: 'string' },
        },
        required: ['text', 'diagnosticCode', 'relevantText'],
      },
    },
  ],
}));

server.setRequestHandler('tools/call', async (req) => {
  const { name, arguments: args } = req.params;
  if (name === 'analyze') {
    const results = await engine.analyze({ text: args.text, filePath: args.filePath });
    return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
  }
  if (name === 'fix') {
    const { SurgicalFixer } = await import('../core/fixer.js');
    const fixer = new SurgicalFixer(provider);
    const result = await fixer.fixIssue(args.text, args.filePath ?? '', {
      code: args.diagnosticCode,
      message: args.relevantText,
      severity: 'warning',
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      analyzer: 'mcp',
      relevantText: args.relevantText,
    });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
  throw new Error(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

## To activate

1. `npm install @modelcontextprotocol/sdk`
2. Move `src/mcp/server.ts` out of `tsconfig` exclude list (or build separately)
3. Add to your MCP client config:
   ```json
   {
     "mcpServers": {
       "skills-review": {
         "command": "node",
         "args": ["./out/mcp/server.js"],
         "env": { "OPENROUTER_API_KEY": "<your-key>" }
       }
     }
   }
   ```

The MCP seam is intentionally a stub — the VS Code language model tools (Phase 5) are the primary agentic surface. The MCP path is for headless CI/review pipeline use-cases.
