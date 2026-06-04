import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Engine } from '../core/index';
import { SurgicalFixer } from '../core/fixer';
import { GitHubModelsProvider, OpenRouterProvider } from '../providers/externalProvider';
import type { AnalysisResult, LlmProvider } from '../core/types';

export interface McpToolRegistryOptions {
  buildEngine?: () => Promise<Engine>;
}

export interface McpToolCallResult {
  content: Array<{ type: 'text'; text: string }>;
}

function createDefaultEngine(): Promise<Engine> {
  const githubToken = process.env.GITHUB_TOKEN?.trim();
  if (githubToken) {
    const provider = new GitHubModelsProvider({
      apiKey: githubToken,
      model: process.env.ANALYSIS_MODEL ?? 'gpt-4o-mini',
    });
    return Promise.resolve(new Engine(provider));
  }

  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();
  if (openRouterKey) {
    const provider = new OpenRouterProvider({
      apiKey: openRouterKey,
      model: process.env.ANALYSIS_MODEL ?? 'openai/gpt-4o-mini',
    });
    return Promise.resolve(new Engine(provider));
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
  return {
    listTools() {
      return [
        {
          name: 'analyze',
          description: 'Analyze a skill or prompt document for quality issues.',
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
          description: 'Surgically fix one issue in a skill or prompt document.',
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
      ];
    },

    async callTool(name, args) {
      if (name === 'analyze') {
        const text = typeof args.text === 'string' ? args.text : '';
        if (!text.trim()) throw new Error('Missing required argument: text');

        const engine = await buildEngine();
        const results = await engine.analyze({
          text,
          filePath: typeof args.filePath === 'string' ? args.filePath : undefined,
        });

        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      }

      if (name === 'fix') {
        const text = typeof args.text === 'string' ? args.text : '';
        const diagnosticCode = typeof args.diagnosticCode === 'string' ? args.diagnosticCode : '';
        const relevantText = typeof args.relevantText === 'string' ? args.relevantText : '';

        if (!text.trim()) throw new Error('Missing required argument: text');
        if (!diagnosticCode.trim()) throw new Error('Missing required argument: diagnosticCode');
        if (!relevantText.trim()) throw new Error('Missing required argument: relevantText');

        const engine = await buildEngine();
        const syntheticDiag: AnalysisResult = {
          code: diagnosticCode,
          message: relevantText,
          severity: 'warning',
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          analyzer: 'mcp',
          relevantText,
        };

        const fixer = new SurgicalFixer(engine.provider as LlmProvider);
        const result = await fixer.fixIssue(text, typeof args.filePath === 'string' ? args.filePath : '', syntheticDiag, {
          additive: true,
          semanticCheck: false,
          selfCritique: false,
          referenceGrounding: true,
        });

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      throw new Error(`Unknown tool: ${name}`);
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
    return result as any;
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
  const { start } = createMcpServer();
  await start();
}

if (require.main === module) {
  void main().catch((error) => {
    console.error('MCP server failed:', error);
    process.exitCode = 1;
  });
}
