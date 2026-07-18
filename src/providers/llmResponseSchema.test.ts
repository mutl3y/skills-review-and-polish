/**
 * Schema-strict-mode compatibility audit.
 *
 * OpenAI's strict mode rejects schemas where any property under `properties`
 * is missing from `required`. This file asserts our schema is OpenAI-strict-
 * compatible so a future field addition can't silently break OpenAI again.
 */
import { describe, it, expect } from 'vitest';
import { LLM_RESPONSE_SCHEMA } from './llmResponseSchema';

interface ObjectSchemaNode {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  items?: unknown;
  [key: string]: unknown;
}

function isObjectNode(n: unknown): n is ObjectSchemaNode {
  return !!n && typeof n === 'object' && (n as { type?: string }).type === 'object';
}

/**
 * Walk the schema and collect every (path, missingKeys[]) violation.
 * A violation is any object node whose `properties` declares keys not
 * all present in `required`.
 */
function findOptionalProperties(node: unknown, path: string): Array<{ path: string; missing: string[] }> {
  const violations: Array<{ path: string; missing: string[] }> = [];
  if (isObjectNode(node)) {
    if (node.properties) {
      const props = Object.keys(node.properties);
      const required = node.required ?? [];
      const missing = props.filter(p => !required.includes(p));
      if (missing.length > 0) {
        violations.push({ path, missing });
      }
      for (const [k, v] of Object.entries(node.properties)) {
        violations.push(...findOptionalProperties(v, `${path}.${k}`));
      }
    }
    if (node.items) {
      violations.push(...findOptionalProperties(node.items, `${path}[]`));
    }
  }
  return violations;
}

describe('LLM_RESPONSE_SCHEMA — OpenAI strict-mode compatibility', () => {
  it('has no properties missing from their object\'s required array', () => {
    const violations = findOptionalProperties(LLM_RESPONSE_SCHEMA, 'root');
    expect(violations).toEqual([]);
  });

  it('declares all 8 expected top-level wave keys as required', () => {
    // Cast to mutable view: the schema is declared `as const` so the
    // readonly tuple type prevents `string[]` assignment, but at runtime
    // it's a plain array of strings.
    const schema = LLM_RESPONSE_SCHEMA as unknown as { required?: string[] };
    const required = schema.required ?? [];
    for (const key of [
      'contradictions',
      'ambiguity_issues',
      'persona_issues',
      'cognitive_load',
      'coverage_analysis',
      'hygiene_issues',
      'custom_diagnostics',
      'conflicts',
    ]) {
      expect(required, `expected ${key} in top-level required`).toContain(key);
    }
  });

  it('every object node has additionalProperties: false', () => {
    function walk(node: unknown, path: string): string[] {
      const misses: string[] = [];
      if (isObjectNode(node)) {
        if (node.additionalProperties !== false) misses.push(path);
        for (const [k, v] of Object.entries(node.properties ?? {})) {
          misses.push(...walk(v, `${path}.${k}`));
        }
        if (node.items) misses.push(...walk(node.items, `${path}[]`));
      }
      return misses;
    }
    const misses = walk(LLM_RESPONSE_SCHEMA, 'root');
    expect(misses).toEqual([]);
  });
});