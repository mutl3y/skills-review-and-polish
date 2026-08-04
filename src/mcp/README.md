# MCP Server Seam

This directory contains the headless MCP seam for wrapping the `skills-review-and-polish` engine as an [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server.

## Tools

The server exposes seven tools:

| Tool | Description |
| --- | --- |
| `analyze` | Run analysis waves on a document. Returns JSON diagnostics with codes, severities, line ranges, and suggestions. Use `analysisWaves` (or legacy `enabledWaves`) to select specific waves, or omit for configured defaults. |
| `fix` | Surgically fix ONE issue. Returns proposed fix text, accept/reject status, and risk flags. Only works on 5 codes: `ambiguity-llm`, `contradiction`, `hygiene-redundant-instruction`, `hygiene-unordered-process`, `hygiene-over-specification`. |
| `score` | Compute quality score (0–100), letter grade (A+ through F), penalty breakdown, and pillar scores. |
| `verify_fix` | Re-analyze a document and check if a specific issue is still present. Returns `{ fixed, matchingIssue, newIssues, issueCount }`. |
| `accept_finding` | Suppress a specific finding on a file so it won't appear in future analyses. |
| `list_accepted_findings` | Return all accepted (suppressed) findings, optionally filtered by file. |
| `health` | Return current provider, model, config source, and connectivity status. |

### Recommended agent workflow

```text
1. health()                                        → verify setup
2. analyze(text)                                   → find issues
3. fix(text, "ambiguity-llm", "...")                → fix one issue
4. verify_fix(text, "ambiguity-llm", "...")         → confirm fix worked
5. score(text)                                     → measure improvement
6. repeat 3–5 for each fixable issue
```

## Why this works cleanly

The `src/core/` module is **extension-agnostic by design** — `src/core/types.ts` has no VS Code imports, and `Engine` only depends on the `LlmProvider` interface. Wrapping it in an MCP server requires:

1. An MCP-compatible transport (e.g. `@modelcontextprotocol/sdk` stdio transport)
2. An `LlmProvider` implementation that calls an external API (already done in `src/providers/externalProvider.ts`)
3. MCP tools mirroring the VS Code `languageModelTools`

The headless MCP seam uses OpenRouter via `OPENROUTER_API_KEY`, or the GitHub
Copilot API via `GITHUB_TOKEN` (uses your Copilot subscription — no separate
API key).

## Long-running analysis & timeouts

Good analysis can take time — a full multi-wave scan of a large skill can run
for minutes, which can exceed an MCP client's default request timeout (the SDK
default is 60s). Two mechanisms address this:

1. **Progress notifications (recommended).** The server emits
   `notifications/progress` every ~15s while a synchronous `analyze` runs. If
   your client sets `resetTimeoutOnProgress` on the request (and passes a
   `_meta.progressToken`), the request stays alive as long as progress keeps
   flowing — so long analyses complete instead of being aborted at 60s.

   ```ts
   // Client (SDK) example — keep the request alive during long analysis
   const result = await client.callTool(
     { name: 'analyze', arguments: { text } },
     undefined,
     { timeout: 300_000, resetTimeoutOnProgress: true }, // 5 min cap, reset on progress
   );
   ```

2. **Raise the client timeout.** Set a generous `timeout` on the request (e.g.
   300s) so the client waits for the full analysis. The server's own HTTP
   request timeout to the LLM provider is configurable via `REQUEST_TIMEOUT_MS`
   env or `requestTimeoutMs` in `.skills-review.json` (default 120s).

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

The MCP seam supports two providers:

- **OpenRouter** — set `OPENROUTER_API_KEY` (or `"provider": "openrouter"` in `.skills-review.json`).
- **Copilot** — set `GITHUB_TOKEN` (or `"provider": "copilot"` in `.skills-review.json`). Uses the GitHub Copilot API (`api.githubcopilot.com`) with your Copilot subscription — no separate API key. Model IDs are Copilot IDs (e.g. `gpt-4o-mini`, `gpt-4.1`, `gpt-5-mini`, `claude-sonnet-4.5`).

### `.skills-review.json` configuration

The MCP server reads a `.skills-review.json` file from the workspace root on startup. This file is written by the VS Code extension's **Sync MCP Config** command (`skillsReviewAndPolish.syncMcpConfig`).

```json
{
  "provider": "openrouter",
  "model": "gpt-4o-mini",
  "deepModel": "gpt-4o",
  "fixModel": "gpt-4o-mini",
  "structuredOutput": false,
  "requestTimeoutMs": 120000,
  "analysisMode": "multiWave",
  "enabledWaves": ["contradictions", "ambiguities", "persona", "structural", "coverage", "hygiene"],
  "analysisWaves": ["contradictions", "ambiguities"],
  "scoreSamples": 3,
  "filterFindings": true,
  "severityOverrides": {
    "coverage-gap": "warning"
  },
  "fixStrategy": "subtractive",
  "fixSemanticCheck": false,
  "fixSelfCritique": false,
  "fixReferenceGrounding": true,
  "logLevel": "info"
}
```

**Analysis modes:**

- `multiWave` (recommended) — Runs all 6 analysis waves separately for best quality
- `focused` — Runs 2 high-signal passes (contradictions + ambiguities)
- `single` — Runs one combined prompt (cheapest/fastest, lower recall)

**Wave selection:**

- `enabledWaves` sets the default waves for multi-wave mode.
- `analysisWaves` is a stricter per-run list that bypasses `analysisMode`.
- Tool calls can pass `analysisWaves` to override the file config for one request.

**Scoring and filtering:**

- `scoreSamples` controls median-of-N scoring for the `score` tool.
- `filterFindings` enables deterministic post-processing before results are returned.
- `severityOverrides` maps diagnostic codes to `error`, `warning`, `info`, `hint`, or `off`.

**External provider reliability:**

- `structuredOutput` requests OpenAI-compatible JSON object mode where supported. Keep it off unless you have validated the selected provider/model path.
- `requestTimeoutMs` bounds a single external-provider HTTP request so a stalled model response cannot hang the MCP server indefinitely.

**Log levels:**

- `info` (default) — Basic operation logging
- `debug` — Detailed tracing including model selection and timing
- `trace` — Full LLM prompt/response logging for debugging

**Config priority at startup:**

1. `.skills-review.json` in workspace root (if exists)
2. `OPENROUTER_API_KEY` or `GITHUB_TOKEN` + `ANALYSIS_MODEL` env vars (legacy)
3. Error: no configuration found

### Provider mapping

| VS Code Provider | MCP Config | API Used | Auth |
| --- | --- | --- | --- |
| `openrouter` | `openrouter` | `openrouter.ai/api/v1` | `OPENROUTER_API_KEY` |
| `copilot` | `copilot` | `api.githubcopilot.com` | `GITHUB_TOKEN` |

### Env-only setup (no VS Code extension)

For headless/CI usage without the extension, set env vars directly.

**OpenRouter:**

```json
{
  "env": {
    "OPENROUTER_API_KEY": "<your-openrouter-key>",
    "ANALYSIS_MODEL": "google/gemini-2.5-flash-lite",
    "DEEP_MODEL": "deepseek/deepseek-chat-v3",
    "FIX_MODEL": "google/gemini-2.5-flash-lite",
    "STRUCTURED_OUTPUT": "0",
    "REQUEST_TIMEOUT_MS": "120000",
    "ANALYSIS_MODE": "multiWave",
    "SCORE_SAMPLES": "3"
  }
}
```

**Copilot (uses your Copilot subscription — no separate API key):**

```json
{
  "env": {
    "GITHUB_TOKEN": "<your-github-token>",
    "ANALYSIS_MODEL": "gpt-5-mini",
    "DEEP_MODEL": "gpt-5.4",
    "FIX_MODEL": "gpt-5-mini",
    "STRUCTURED_OUTPUT": "0",
    "REQUEST_TIMEOUT_MS": "120000",
    "ANALYSIS_MODE": "multiWave",
    "SCORE_SAMPLES": "3"
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
        "ANALYSIS_MODEL": "gpt-5-mini"
      }
    }
  }
}
```

## To activate

1. Run `npm install` in the repo root.
2. Build the server with `npm run compile`.
3. Start it with `npm run mcp`, or point your MCP client directly at `node ./out/mcp/server.js`.
4. **Either** create `.skills-review.json` in the workspace root (via the VS Code **Sync MCP Config** command), **or** set env vars as shown above.

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
import { OpenRouterProvider } from './out/providers/externalProvider.js';
import { DEFAULT_ENGINE_CONFIG } from './out/core/types.js';

const skillPath = path.resolve('tests/fixtures/primary/test-ambiguities/SKILL.md');
const text = fs.readFileSync(skillPath, 'utf8');

const buildEngine = async () =>
  new Engine(
    new OpenRouterProvider({
      apiKey: process.env.OPENROUTER_API_KEY ?? '',
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
