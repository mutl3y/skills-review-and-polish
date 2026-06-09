import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs';
import * as path from 'path';
import { Engine } from '../core/index';
import { SurgicalFixer } from '../core/fixer';
import { setTransport } from '../core/logger';
import { acceptFinding, loadAcceptedFindings, isFindingAccepted } from '../core/acceptedFindings';
import { GitHubModelsProvider, OpenRouterProvider } from '../providers/externalProvider';
import type { AnalysisResult, LlmProvider } from '../core/types';

export interface McpEngineConfig {
  provider: string;
  model: string;
  configSource: string;
}

/** Maximum text length accepted by tools. Prevents runaway LLM costs. */
const MAX_TEXT_LENGTH = 100_000; // ~25k tokens

/**
 * Sanitize an error message to remove secrets (Bearer tokens, API keys, etc.)
 * before returning it in MCP responses.
 */
function sanitizeErrorMessage(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  // Strip Bearer tokens
  let sanitized = msg.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]');
  // Strip potential API key patterns (long hex strings after common key patterns)
  sanitized = sanitized.replace(/(api[_-]?key|token|secret|password)[\s:=]+\S+/gi, '$1=[REDACTED]');
  return sanitized;
}

/** Resolve the accepted-findings path from MCP_SERVER_WORKSPACE env var (or cwd fallback). */
function resolveAcceptedFindingsPath(): string {
  const workspaceRoot = process.env['MCP_SERVER_WORKSPACE']?.trim() || process.cwd();
  return path.join(workspaceRoot, '.accepted-findings.json');
}

function requireString(args: Record<string, unknown>, key: string): string {
  const val = typeof args[key] === 'string' ? args[key] : '';
  if (!val.trim()) throw new Error(`Missing required argument: ${key}`);
  return val;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  return typeof args[key] === 'string' && (args[key] as string).trim() ? (args[key] as string) : undefined;
}

function requireText(args: Record<string, unknown>): string {
  const text = requireString(args, 'text');
  if (text.length > MAX_TEXT_LENGTH) {
    throw new Error(`Text too long: ${text.length} chars (max ${MAX_TEXT_LENGTH}). Split the document or analyze a subsection.`);
  }
  return text;
}

interface ToolHandlerContext {
  getEngine: () => Promise<Engine>;
  resolvedConfig: McpEngineConfig | undefined;
}

type ToolHandler = (args: Record<string, unknown>, ctx: ToolHandlerContext) => Promise<McpToolCallResult>;

async function handleAnalyze(args: Record<string, unknown>, ctx: ToolHandlerContext): Promise<McpToolCallResult> {
  const text = requireText(args);
  const engine = await ctx.getEngine();
  const results = await engine.analyze({
    text,
    filePath: optionalString(args, 'filePath'),
    acceptedFindingsPath: resolveAcceptedFindingsPath(),
  });
  return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
}

async function handleFix(args: Record<string, unknown>, ctx: ToolHandlerContext): Promise<McpToolCallResult> {
  const text = requireText(args);
  const diagnosticCode = requireString(args, 'diagnosticCode');
  const relevantText = requireString(args, 'relevantText');
  const line = typeof args['line'] === 'number' ? args['line'] : (typeof args['line'] === 'string' ? parseInt(args['line'], 10) : 0);

  const engine = await ctx.getEngine();
  const syntheticDiag: AnalysisResult = {
    code: diagnosticCode,
    message: relevantText,
    severity: 'warning',
    range: { start: { line, character: 0 }, end: { line, character: 0 } },
    analyzer: 'mcp',
    relevantText,
  };

  const fixer = new SurgicalFixer(engine.provider as LlmProvider);
  const result = await fixer.fixIssue(text, optionalString(args, 'filePath') ?? '', syntheticDiag, {
    additive: true,
    semanticCheck: false,
    selfCritique: false,
    referenceGrounding: true,
  });

  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

async function handleAcceptFinding(args: Record<string, unknown>, _ctx: ToolHandlerContext): Promise<McpToolCallResult> {
  const filePath = requireString(args, 'filePath');
  const diagnosticCode = requireString(args, 'diagnosticCode');
  const relevantText = requireString(args, 'relevantText');
  const reason = optionalString(args, 'reason');

  acceptFinding(resolveAcceptedFindingsPath(), filePath, {
    code: diagnosticCode,
    textPattern: relevantText,
    acceptedAt: new Date().toISOString(),
    reason,
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        status: 'accepted',
        filePath,
        code: diagnosticCode,
      }, null, 2),
    }],
  };
}

async function handleHealth(_args: Record<string, unknown>, ctx: ToolHandlerContext): Promise<McpToolCallResult> {
  try {
    await ctx.getEngine();
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'ok',
          provider: ctx.resolvedConfig?.provider ?? 'unknown',
          model: ctx.resolvedConfig?.model ?? 'unknown',
          configSource: ctx.resolvedConfig?.configSource ?? 'unknown',
        }, null, 2),
      }],
    };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'error',
          error: sanitizeErrorMessage(error),
        }, null, 2),
      }],
    };
  }
}

async function handleScore(args: Record<string, unknown>, ctx: ToolHandlerContext): Promise<McpToolCallResult> {
  const text = requireText(args);
  const engine = await ctx.getEngine();
  const result = await engine.score({
    text,
    filePath: optionalString(args, 'filePath'),
  });
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

async function handleVerifyFix(args: Record<string, unknown>, ctx: ToolHandlerContext): Promise<McpToolCallResult> {
  const text = requireText(args);
  const diagnosticCode = requireString(args, 'diagnosticCode');
  const relevantText = requireString(args, 'relevantText');

  const engine = await ctx.getEngine();

  // 1. Re-analyze (6 waves — the only LLM cost)
  const results = await engine.analyze({
    text,
    filePath: optionalString(args, 'filePath'),
    acceptedFindingsPath: resolveAcceptedFindingsPath(),
  });

  // 2. Check if target issue is gone
  const targetAccepted = [{ code: diagnosticCode, textPattern: relevantText, acceptedAt: '' }];
  const matchingIssue = results.find((r) => isFindingAccepted(r, targetAccepted)) ?? null;
  const newIssues = results.filter((r) => !isFindingAccepted(r, targetAccepted));

  // 3. Return result WITHOUT the expensive score call
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        fixed: matchingIssue === null,
        matchingIssue,
        newIssues,
        issueCount: results.length,
      }, null, 2),
    }],
  };
}

async function handleListAcceptedFindings(args: Record<string, unknown>, _ctx: ToolHandlerContext): Promise<McpToolCallResult> {
  const filePath = optionalString(args, 'filePath');
  const store = loadAcceptedFindings(resolveAcceptedFindingsPath());

  if (filePath) {
    const entries = store.entries[filePath] ?? [];
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ filePath, entries }, null, 2),
      }],
    };
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(store, null, 2),
    }],
  };
}

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  analyze: handleAnalyze,
  fix: handleFix,
  accept_finding: handleAcceptFinding,
  health: handleHealth,
  score: handleScore,
  verify_fix: handleVerifyFix,
  list_accepted_findings: handleListAcceptedFindings,
};

export interface McpToolRegistryOptions {
  buildEngine?: () => Promise<{ engine: Engine; config: McpEngineConfig }> | { engine: Engine; config: McpEngineConfig };
}

export interface McpToolCallResult {
  content: Array<{ type: 'text'; text: string }>;
}

function createDefaultEngine(): { engine: Engine; config: McpEngineConfig } {
  // Priority 1: .skills-review.json in workspace root
  // MCP_SERVER_WORKSPACE env var takes precedence for config discovery,
  // falling back to process.cwd() for CLI usage.
  const workspaceRoot = process.env.MCP_SERVER_WORKSPACE?.trim() || process.cwd();
  const configPath = path.join(workspaceRoot, '.skills-review.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const cfg = JSON.parse(raw);
    if (cfg && typeof cfg === 'object') {
      const provider = cfg.provider || 'githubModels';
      const model = cfg.model || 'gpt-4o-mini';

      if (provider === 'openrouter') {
        const apiKey = process.env.OPENROUTER_API_KEY?.trim();
        if (apiKey) {
          return {
            engine: new Engine(new OpenRouterProvider({ apiKey, model })),
            config: { provider: 'openrouter', model, configSource: 'file:.skills-review.json' } as McpEngineConfig,
          };
        }
      }
      // Default: use GitHub Models (works for both vscode-lm and githubModels)
      const apiKey = process.env.GITHUB_TOKEN?.trim();
      if (apiKey) {
        return {
          engine: new Engine(new GitHubModelsProvider({ apiKey, model })),
          config: { provider: 'githubModels', model, configSource: 'file:.skills-review.json' } as McpEngineConfig,
        };
      }
    }
  } catch {
    // File doesn't exist or is malformed — fall through to env vars
  }

  // Priority 2: env vars (existing logic)
  const githubToken = process.env.GITHUB_TOKEN?.trim();
  if (githubToken) {
    const model = process.env.ANALYSIS_MODEL ?? 'gpt-4o-mini';
    const provider = new GitHubModelsProvider({ apiKey: githubToken, model });
    return {
      engine: new Engine(provider),
      config: { provider: 'githubModels', model, configSource: 'env:GITHUB_TOKEN' } as McpEngineConfig,
    };
  }

  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();
  if (openRouterKey) {
    const model = process.env.ANALYSIS_MODEL ?? 'openai/gpt-4o-mini';
    const provider = new OpenRouterProvider({ apiKey: openRouterKey, model });
    return {
      engine: new Engine(provider),
      config: { provider: 'openrouter', model, configSource: 'env:OPENROUTER_API_KEY' } as McpEngineConfig,
    };
  }

  throw new Error(
    'MCP provider configuration missing. Set GITHUB_TOKEN for GitHub Models, or OPENROUTER_API_KEY for the fallback provider.',
  );
}

export function createMcpToolRegistry({
  buildEngine = createDefaultEngine,
}: McpToolRegistryOptions = {}): {
  listTools(): Array<{ name: string; description: string; inputSchema: unknown }>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult>;
} {
  // Resolve engine + config once; handlers use the stored values.
  let resolvedEngine: Engine | undefined;
  let resolvedConfig: McpEngineConfig | undefined;

  async function getEngine(): Promise<Engine> {
    if (!resolvedEngine) {
      const raw = buildEngine();
      const result = (raw instanceof Promise) ? await raw : raw;
      // Support both new { engine, config } shape and legacy direct-engine shape.
      if ('engine' in result && 'config' in result) {
        resolvedEngine = result.engine;
        resolvedConfig = result.config;
      } else {
        resolvedEngine = result as unknown as Engine;
        resolvedConfig = { provider: 'unknown', model: 'unknown', configSource: 'unknown' } as McpEngineConfig;
      }
    }
    return resolvedEngine;
  }

  return {
    listTools() {
      return [
        {
          name: 'analyze',
          description:
            'Analyze a skill, instructions, or prompt document for quality issues. Runs 6 focused analysis waves: contradictions, ambiguities, persona conflicts, structural/cognitive issues, coverage gaps, and hygiene problems. Returns a JSON array of diagnostics, each with: code (e.g. "ambiguity-llm", "contradiction", "coverage-gap"), severity (error/warning/info), message, range, and optional suggestion. Use "score" to get an overall quality grade. Use "fix" to attempt surgical repair of fixable issues (only 5 codes are fixable: ambiguity-llm, contradiction, hygiene-redundant-instruction, hygiene-unordered-process, hygiene-over-specification).',
          inputSchema: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Full document text to analyze.' },
              filePath: { type: 'string', description: 'Optional file path for context.' },
            },
            required: ['text'],
          },
        },
        {
          name: 'fix',
          description:
            'Surgically fix ONE quality issue in a document. Returns the proposed fixed text and whether it was accepted or rejected (with reason). Only works on these 5 codes: ambiguity-llm, contradiction, hygiene-redundant-instruction, hygiene-unordered-process, hygiene-over-specification. All other codes (coverage-gap, persona-inconsistency, cognitive-*, etc.) are NOT fixable \u2014 the tool will return accepted:false. Use "analyze" first to find issues, then "fix" on each fixable one. Use "verify_fix" after to confirm the fix worked.',
          inputSchema: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Full document text to update.' },
              filePath: { type: 'string', description: 'Optional file path for grounding.' },
              diagnosticCode: { type: 'string', description: 'Issue code to fix.' },
              relevantText: { type: 'string', description: 'Verbatim text that triggered the issue.' },
            },
            required: ['text', 'diagnosticCode', 'relevantText'],
          },
        },
        {
          name: 'accept_finding',
          description:
            'Accept (suppress) a specific finding on a specific file so it will not appear in future analyses. Use this for known/expected issues that are intentional (e.g. self-referential prompt patterns). The finding is matched by code AND text pattern \u2014 accepting "ambiguity-llm" on "vague or underspecified" in file.md won\'t suppress a different ambiguity-llm finding in the same file.',
          inputSchema: {
            type: 'object',
            properties: {
              filePath: { type: 'string', description: 'Absolute path to the file.' },
              diagnosticCode: { type: 'string', description: 'Issue code to accept (e.g. ambiguity-llm, coverage-gap).' },
              relevantText: { type: 'string', description: 'The verbatim text that triggered the finding.' },
              reason: { type: 'string', description: 'Optional reason for accepting.' },
            },
            required: ['filePath', 'diagnosticCode', 'relevantText'],
          },
        },
        {
          name: 'health',
          description:
            'Check the MCP server status. Returns provider name, model ID, config source (file/env/default), and whether the provider is reachable. Use this first to verify setup before running analyses.',
          inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
          name: 'score',
          description:
            'Compute the quality score (0-100) and letter grade (A+ through F) for a document. Returns score, grade, penalty breakdown (issues + length), pillar scores (Contradictions, Clarity, Completeness, Structure), skill type, and line count. Use this before/after fixes to measure improvement.',
          inputSchema: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Full document text.' },
              filePath: { type: 'string', description: 'Optional file path for context.' },
            },
            required: ['text'],
          },
        },
        {
          name: 'verify_fix',
          description:
            "Re-analyze a document and check if a specific issue has been resolved. Provide the original diagnostic code and text pattern. Returns: fixed (boolean), the matching issue if still present, any new issues introduced by the fix, and total issue count. Use this after 'fix' to confirm the fix worked without side effects. Call 'score' separately to get the updated quality grade.",
          inputSchema: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Full document text (post-fix).' },
              filePath: { type: 'string', description: 'Optional file path.' },
              diagnosticCode: { type: 'string', description: 'The issue code to check.' },
              relevantText: { type: 'string', description: 'The text pattern that triggered the original issue.' },
            },
            required: ['text', 'diagnosticCode', 'relevantText'],
          },
        },
        {
          name: 'list_accepted_findings',
          description:
            'List all accepted (suppressed) findings, optionally filtered by file path. Returns the full store contents with code, textPattern, acceptedAt, and reason for each entry.',
          inputSchema: {
            type: 'object',
            properties: {
              filePath: { type: 'string', description: 'Optional filter by file path.' },
            },
            required: [],
          },
        },
      ];
    },

    async callTool(name, args) {
      const handler = TOOL_HANDLERS[name];
      if (!handler) throw new Error(`Unknown tool: ${name}`);
      return handler(args, { getEngine, resolvedConfig });
    },
  };
}

export function createMcpServer(options: McpToolRegistryOptions = {}) {
  const registry = createMcpToolRegistry(options);

  const server = new Server(
    { name: 'skills-review-and-polish', version: '0.0.1' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: registry.listTools() }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await registry.callTool(String(request.params.name), (request.params.arguments ?? {}) as Record<string, unknown>);
    return result as CallToolResult;
  });

  return {
    server,
    async start() {
      const transport = new StdioServerTransport();
      await server.connect(transport);
    },
  };
}

export async function main(): Promise<void> {
  // Wire core logger to stderr — MCP uses stdio for protocol communication.
  setTransport((line) => process.stderr.write(line + '\n'));

  const { start } = createMcpServer();
  await start();
}

if (require.main === module) {
  void main().catch((error) => {
    console.error('MCP server failed:', error);
    process.exitCode = 1;
  });
}
