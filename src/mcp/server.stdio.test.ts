/**
 * MCP stdio integration tests — validates the actual StdioServerTransport
 * path that runs when an external MCP client (Copilot, Claude, etc.)
 * connects to the server via stdin/stdout.
 *
 * Spawns the server as a child process and communicates via newline-delimited
 * JSON-RPC (the format the MCP SDK uses for stdio transport).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

/**
 * Send a JSON-RPC request over the child process stdin and read the response.
 * The MCP SDK uses newline-delimited JSON (each message is one line + '\n').
 */
function sendRequest(proc: ChildProcess, method: string, params: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const requestId = Math.floor(Math.random() * 1_000_000);
    const request = JSON.stringify({
      jsonrpc: '2.0',
      id: requestId,
      method,
      params,
    });

    let stdout = '';
    let responseReceived = false;

    const onData = (chunk: Buffer) => {
      stdout += chunk.toString();
      // Split on newlines — each line is a complete JSON-RPC message
      const lines = stdout.split('\n');
      // Keep the last potentially-incomplete line in the buffer
      const completeLines = lines.slice(0, -1);
      stdout = lines[lines.length - 1]; // remainder

      for (const line of completeLines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);
          if (msg.id === requestId && msg.jsonrpc === '2.0') {
            responseReceived = true;
            proc.stdout?.off('data', onData);
            resolve(msg.result ?? msg.error);
          }
        } catch {
          // Not valid JSON — skip
        }
      }
    };

    proc.stdout?.on('data', onData);
    proc.stdin?.write(request + '\n');

    // Timeout after 10 seconds
    const timeout = setTimeout(() => {
      if (!responseReceived) {
        proc.stdout?.off('data', onData);
        reject(new Error(`Timeout waiting for response to ${method}`));
      }
    }, 10_000);

    // Clean up timeout if response arrives
    const interval = setInterval(() => {
      if (responseReceived) {
        clearTimeout(timeout);
        clearInterval(interval);
      }
    }, 100);
    setTimeout(() => clearInterval(interval), 11_000);
  });
}

describe('MCP stdio transport', () => {
  let serverProcess: ChildProcess;

  beforeAll(async () => {
    // Compile must have been run — use the out/ directory
    const serverPath = path.resolve(__dirname, '../../out/mcp/server.js');
    serverProcess = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    // Wait for the server to start (give it 2 seconds)
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Check the process is still running
    if (serverProcess.exitCode !== null) {
      throw new Error(`MCP server exited immediately with code ${serverProcess.exitCode}`);
    }
  });

  afterAll(async () => {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill('SIGTERM');
      // Wait for graceful shutdown
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (!serverProcess.killed) {
        serverProcess.kill('SIGKILL');
      }
    }
  });

  it('responds to tools/list', async () => {
    const result = await sendRequest(serverProcess, 'tools/list', {});
    expect(result).toBeDefined();
    const tools = (result as { tools: Array<{ name: string }> }).tools;
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBe(7);

    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'accept_finding',
      'analyze',
      'fix',
      'health',
      'list_accepted_findings',
      'score',
      'verify_fix',
    ]);
  });

  it('responds to tools/call for health', async () => {
    const result = await sendRequest(serverProcess, 'tools/call', {
      name: 'health',
      arguments: {},
    });
    expect(result).toBeDefined();
    const content = (result as { content: Array<{ type: string; text: string }> }).content;
    expect(Array.isArray(content)).toBe(true);
    expect(content.length).toBe(1);

    const parsed = JSON.parse(content[0].text);
    expect(parsed.status).toBe('ok');
    expect(parsed.provider).toBeDefined();
    expect(parsed.configSource).toBeDefined();
  });

  it('responds to tools/call for accept_finding', async () => {
    const result = await sendRequest(serverProcess, 'tools/call', {
      name: 'accept_finding',
      arguments: {
        filePath: '/tmp/stdio-test.md',
        diagnosticCode: 'ambiguity-llm',
        relevantText: 'vague stdio test',
        reason: 'stdio integration test',
      },
    });
    expect(result).toBeDefined();
    const content = (result as { content: Array<{ type: string; text: string }> }).content;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.status).toBe('accepted');
  });

  it('returns isError for unknown tool', async () => {
    const result = await sendRequest(serverProcess, 'tools/call', {
      name: 'nonexistent',
      arguments: {},
    });
    expect(result).toBeDefined();
    // The MCP server catches unknown-tool errors and returns content with isError
    const errResult = result as { content?: Array<{ type: string; text: string }>; isError?: boolean };
    expect(errResult.isError).toBe(true);
    const parsed = JSON.parse(errResult.content![0].text);
    expect(parsed.error).toContain('Unknown tool');
  });
});
