import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setLogLevel,
  getLogLevel,
  setTransport,
  getTransport,
  createLogger,
  Logger,
} from './logger';

// Capture the original values to restore after each test
let originalLevel: ReturnType<typeof getLogLevel>;
let originalTransport: ReturnType<typeof getTransport>;

beforeEach(() => {
  originalLevel = getLogLevel();
  originalTransport = getTransport();
});

afterEach(() => {
  setLogLevel(originalLevel);
  setTransport(originalTransport);
});

// ─── setLogLevel / getLogLevel ────────────────────────────────────────────────

describe('setLogLevel / getLogLevel', () => {
  it('round-trips all three levels', () => {
    for (const level of ['info', 'debug', 'trace'] as const) {
      setLogLevel(level);
      expect(getLogLevel()).toBe(level);
    }
  });
});

// ─── setTransport / getTransport ─────────────────────────────────────────────

describe('setTransport / getTransport', () => {
  it('returns the installed transport', () => {
    const t = vi.fn();
    setTransport(t);
    expect(getTransport()).toBe(t);
  });
});

// ─── Logger level filtering ───────────────────────────────────────────────────

describe('Logger level filtering', () => {
  it('info emits at all levels', () => {
    const lines: string[] = [];
    setTransport(l => lines.push(l));

    for (const level of ['info', 'debug', 'trace'] as const) {
      lines.length = 0;
      setLogLevel(level);
      createLogger('test').info('msg');
      expect(lines).toHaveLength(1);
    }
  });

  it('debug is suppressed at info level', () => {
    const lines: string[] = [];
    setTransport(l => lines.push(l));
    setLogLevel('info');
    createLogger('test').debug('should be suppressed');
    expect(lines).toHaveLength(0);
  });

  it('debug emits at debug level', () => {
    const lines: string[] = [];
    setTransport(l => lines.push(l));
    setLogLevel('debug');
    createLogger('test').debug('visible');
    expect(lines).toHaveLength(1);
  });

  it('trace is suppressed at info and debug level', () => {
    const lines: string[] = [];
    setTransport(l => lines.push(l));
    for (const level of ['info', 'debug'] as const) {
      lines.length = 0;
      setLogLevel(level);
      createLogger('test').trace('should be suppressed');
      expect(lines).toHaveLength(0);
    }
  });

  it('trace emits at trace level', () => {
    const lines: string[] = [];
    setTransport(l => lines.push(l));
    setLogLevel('trace');
    createLogger('test').trace('visible');
    expect(lines).toHaveLength(1);
  });
});

// ─── Logger format ────────────────────────────────────────────────────────────

describe('Logger format', () => {
  it('includes ISO timestamp, level, module name, and message', () => {
    const lines: string[] = [];
    setTransport(l => lines.push(l));
    setLogLevel('info');
    createLogger('my-module').info('hello world');
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(lines[0]).toContain('[INFO ]');
    expect(lines[0]).toContain('[my-module]');
    expect(lines[0]).toContain('hello world');
  });

  it('appends JSON-serialized data when provided', () => {
    const lines: string[] = [];
    setTransport(l => lines.push(l));
    setLogLevel('info');
    createLogger('test').info('msg', { count: 3, wave: 'ambiguities' });
    expect(lines[0]).toContain('"count":3');
    expect(lines[0]).toContain('"wave":"ambiguities"');
  });

  it('falls back gracefully when data cannot be serialized', () => {
    const lines: string[] = [];
    setTransport(l => lines.push(l));
    setLogLevel('info');
    // Circular reference will cause JSON.stringify to throw
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    createLogger('test').info('msg', circular as any);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('[data serialization failed]');
  });

  it('omits trailing JSON when no data provided', () => {
    const lines: string[] = [];
    setTransport(l => lines.push(l));
    setLogLevel('info');
    createLogger('test').info('bare message');
    // Should not end with a space + JSON blob
    expect(lines[0]).toMatch(/bare message$/);
  });
});

// ─── Logger.child ─────────────────────────────────────────────────────────────

describe('Logger.child', () => {
  it('prefixes the sub-module with a colon separator', () => {
    const lines: string[] = [];
    setTransport(l => lines.push(l));
    setLogLevel('info');
    const log = createLogger('parent');
    log.child('child').info('from child');
    expect(lines[0]).toContain('[parent:child]');
  });

  it('child logger respects the same log level as the parent', () => {
    const lines: string[] = [];
    setTransport(l => lines.push(l));
    setLogLevel('info');
    createLogger('parent').child('child').debug('suppressed');
    expect(lines).toHaveLength(0);
  });
});

// ─── createLogger ─────────────────────────────────────────────────────────────

describe('createLogger', () => {
  it('returns a Logger instance', () => {
    expect(createLogger('x')).toBeInstanceOf(Logger);
  });
});
