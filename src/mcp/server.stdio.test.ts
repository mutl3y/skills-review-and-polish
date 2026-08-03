/**
 * MCP stdio transport tests. These use the real SDK StdioServerTransport
 * against in-memory streams so JSON-RPC framing and initialization are covered
 * without relying on nested child-process stdin behavior.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { PassThrough } from 'stream';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from './server';

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number;
  result?: unknown;
  error?: unknown;
}

let stopServer: (() => Promise<void>) | undefined;

function writeMessage(input: PassThrough, message: unknown): void {
  input.write(JSON.stringify(message) + '\n');
}

function waitForResponse(output: PassThrough, id: number): Promise<JsonRpcResponse> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timeout = setTimeout(() => {
      output.off('data', onData);
      reject(new Error(`Timed out waiting for JSON-RPC response ${id}`));
    }, 5_000);

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const parsed = JSON.parse(line) as JsonRpcResponse;
        if (parsed.id === id) {
          clearTimeout(timeout);
          output.off('data', onData);
          resolve(parsed);
        }
      }
    };

    output.on('data', onData);
  });
}

async function createHarness() {
  const clientToServer = new PassThrough();
  const serverToClient = new PassThrough();
  const transport = new StdioServerTransport(clientToServer, serverToClient);
  const mcp = createMcpServer({
    transport,
    buildEngine: async () => ({
      engine: { analyze: async () => [], provider: {} } as any,
      config: { provider: 'test', model: 'test', configSource: 'test' },
    }),
  });

  await mcp.start();
  stopServer = mcp.stop;

  writeMessage(clientToServer, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: 'skills-review-and-polish-stdio-test',
        version: '0.0.0',
      },
    },
  });
  await waitForResponse(serverToClient, 1);
  writeMessage(clientToServer, {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
    params: {},
  });

  return { clientToServer, serverToClient };
}

async function callMcp(method: string, params: unknown): Promise<unknown> {
  const { clientToServer, serverToClient } = await createHarness();
  writeMessage(clientToServer, {
    jsonrpc: '2.0',
    id: 2,
    method,
    params,
  });
  const response = await waitForResponse(serverToClient, 2);
  return response.result ?? response.error;
}

afterEach(async () => {
  if (stopServer) {
    await stopServer();
    stopServer = undefined;
  }
});

describe('MCP stdio transport', () => {
  it('responds to tools/list', async () => {
    const result = await callMcp('tools/list', {});

    const tools = (result as { tools: Array<{ name: string }> }).tools;
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.map(t => t.name).sort()).toEqual([
      'accept_finding',
      'analyze',
      'fix',
      'get_analysis_result',
      'health',
      'list_accepted_findings',
      'score',
      'verify_fix',
    ]);
  });

  it('responds to tools/call for health', async () => {
    const result = await callMcp('tools/call', {
      name: 'health',
      arguments: {},
    });

    const content = (result as { content: Array<{ type: string; text: string }> }).content;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.status).toBe('ok');
    expect(parsed.provider).toBe('test');
    expect(parsed.configSource).toBe('test');
  });

  it('responds to tools/call for accept_finding', async () => {
    const result = await callMcp('tools/call', {
      name: 'accept_finding',
      arguments: {
        filePath: '/tmp/stdio-test.md',
        diagnosticCode: 'ambiguity-llm',
        relevantText: 'vague stdio test',
        reason: 'stdio integration test',
      },
    });

    const content = (result as { content: Array<{ type: string; text: string }> }).content;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.status).toBe('accepted');
  });

  it('returns isError for unknown tool', async () => {
    const result = await callMcp('tools/call', {
      name: 'nonexistent',
      arguments: {},
    });

    const errResult = result as { content?: Array<{ type: string; text: string }>; isError?: boolean };
    expect(errResult.isError).toBe(true);
    const parsed = JSON.parse(errResult.content![0].text);
    expect(parsed.error).toContain('Unknown tool');
  });
});
