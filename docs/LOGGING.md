# Logging System

## Overview

The project uses a structured, extension-agnostic logging system defined in
`src/core/logger.ts`. All modules share a single `Logger` class with
pluggable transports and three log levels.

## Architecture

```text
┌─────────────┐     ┌──────────────┐     ┌──────────────────────┐
│  analyzer.ts │────▶│              │────▶│  transport (injected) │
│  fixer.ts    │────▶│  Logger      │────▶│  • extension: OutputChannel + file │
│  provider.ts │────▶│  (per-module)│────▶│  mcp:       stderr   │
│  server.ts   │────▶│              │────▶│  tests:     array[]  │
│  extension.ts│────▶│              │────▶│  default:   console.error │
└─────────────┘     └──────────────┘     └──────────────────────┘
```

### Components

| Component | File | Purpose |
| --- | --- | --- |
| `Logger` class | `src/core/logger.ts` | Per-module logger with `info`/`debug`/`trace` methods |
| `createLogger(name)` | `src/core/logger.ts` | Factory function — one per module |
| `setLogLevel(level)` | `src/core/logger.ts` | Global level control |
| `setTransport(fn)` | `src/core/logger.ts` | Pluggable output destination |

## Log Levels

| Level | Default | When to use | Examples |
| --- | --- | --- | --- |
| `info` | **ON** | Errors, warnings, final results | LLM errors, analysis complete, fix applied |
| `debug` | off | Decision points, model selection, timing | Wave start/end, model tier chosen |
| `trace` | off | Raw data inspection | Prompt previews, response previews, JSON parse steps |

## Build-Time Flag

Set the environment variable `SKILL_REVIEW_LOG_LEVEL` to control the default
level without changing code:

```bash
# Production (default — only info)
node server.js

# Development
SKILL_REVIEW_LOG_LEVEL=debug node server.js

# Full verbosity
SKILL_REVIEW_LOG_LEVEL=trace node server.js
```

The extension overrides this at runtime via `setLogLevel()` based on the
`skillsReviewAndPolish.logLevel` VS Code setting.

## Output Format

Each log line follows this structure:

```text
2026-06-08T12:34:56.789Z [DEBUG] [analyzer] contradictions wave started {"tier":"deep"}
```

Fields:

- **Timestamp** — ISO 8601
- **Level** — `INFO`, `DEBUG`, `TRACE`
- **Module** — `[analyzer]`, `[fixer]`, `[provider]`, etc.
- **Message** — Human-readable description
- **Data** — Optional JSON payload (one-liner)

## Usage

### In a core module (extension-agnostic)

```typescript
import { createLogger } from './logger';

const log = createLogger('analyzer');

// Always-on
log.info('analysis complete', { results: 12 });

// Opt-in (debug level)
log.debug('wave started', { wave: 'contradictions', tier: 'deep' });

// Opt-in (trace level — prompt/response previews)
log.trace('LLM response received', { length: response.text.length, preview: response.text.substring(0, 150) });
```

### In the extension (wiring)

```typescript
import { setLogLevel, setTransport } from './core/logger';

// In activate():
setLogLevel(cfg.logLevel === 'debug' ? 'debug' : 'info');
setTransport((line) => {
  if (cfg.logLevel === 'debug' && logFilePath) {
    fs.appendFileSync(logFilePath, line + '\n');
  }
  out.appendLine(line);
});
```

### In the MCP server

```typescript
import { setTransport } from '../core/logger';

// Wire to stderr (MCP uses stdio for protocol)
setTransport((line) => process.stderr.write(line + '\n'));
```

### In tests

```typescript
import { setTransport, setLogLevel } from './logger';

const captured: string[] = [];
setTransport((line) => captured.push(line));
setLogLevel('trace');
```

## Migration Guide

### `src/core/analyzer.ts`

All `console.log()` calls replaced with structured logger calls:

| Original | New Level | Rationale |
| --- | --- | --- |
| `[analyzeXWave] START` | `debug` | Wave lifecycle — opt-in |
| `[analyzeXWave] END: N issues` | `debug` | Wave lifecycle — opt-in |
| `[extractJSON] attempting to parse` | `trace` | JSON parsing detail |
| `[extractJSON] extracted JSON string` | `trace` | JSON parsing detail |
| `[extractJSON] SUCCESS` | `trace` | JSON parsing detail |
| `[extractJSON] parse failed` | `trace` | JSON parsing detail |
| `[extractJSON] recovered via salvage` | `trace` | JSON parsing detail |
| `[extractJSON] no salvage possible` | `trace` | JSON parsing detail |
| `[callLLM] SENDING REQUEST` | `trace` | Prompt/response data |
| `[callLLM] RESPONSE RECEIVED` | `trace` | Prompt/response data |
| `[callLLM] response content` | `trace` | Prompt/response data |
| `[callLLM] ERROR` | `info` | Error path — always on |
| `[callLLM] SUCCESS` | `trace` | Prompt/response data |

### `src/providers/vscodeLmProvider.ts`

The `logFn` callback constructor parameter is replaced by using
`createLogger('provider')` directly. All existing `this.log(...)` calls
become `this.log.debug(...)` or `this.log.trace(...)` depending on content.

### `src/extension.ts`

The local `log()` function remains for extension-level concerns (activation,
command handlers) but now also calls `setLogLevel()` and `setTransport()`
in `activate()` to wire the core logger.

### `src/mcp/server.ts`

Adds `setTransport()` wiring to `process.stderr.write` at startup.
