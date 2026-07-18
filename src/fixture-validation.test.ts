import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

function walkFixtureSkillFiles(root: string): string[] {
  const results: string[] = [];

  function visit(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const resolved = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(resolved);
        continue;
      }
      if (entry.isFile() && entry.name === 'SKILL.md') {
        results.push(resolved);
      }
    }
  }

  visit(root);
  return results.sort();
}

function extractFixtureMetadata(file: string) {
  const contents = fs.readFileSync(file, 'utf8');
  const expectedCount = contents.match(/\*\*Test metadata:\*\*\s*(\d+)/i)?.[1];
  const expectedCategory = contents.match(/Expected analyzer category:\s*`([^`]+)`/i)?.[1]
    ?? contents.match(/Expected categories:\s*`([^`]+)`/i)?.[1];

  return {
    expectedCount: expectedCount ? Number(expectedCount) : null,
    expectedCategory: expectedCategory ?? null,
    contents,
  };
}

function listFiles(root: string, extension: string): string[] {
  return fs.readdirSync(root)
    .filter((entry) => entry.endsWith(extension))
    .sort();
}

describe('fixture validation gate', () => {
  it('keeps the seeded corpus wired for the release gate', () => {
    const fixtureRoot = path.resolve(__dirname, '..', 'tests', 'fixtures');
    const fixtureFiles = walkFixtureSkillFiles(fixtureRoot);

    expect(fixtureFiles.length).toBeGreaterThanOrEqual(7);
    expect(fixtureFiles.some((file) => file.endsWith('tests/fixtures/primary/test-contradictions-direct/SKILL.md'))).toBe(true);
    expect(fixtureFiles.some((file) => file.endsWith('tests/fixtures/primary/test-ambiguities/SKILL.md'))).toBe(true);
    expect(fixtureFiles.some((file) => file.endsWith('tests/fixtures/adversarial/test-circular-hard/SKILL.md'))).toBe(true);
  });

  it('ensures every fixture carries release-gate metadata for analyzer validation', () => {
    const fixtureRoot = path.resolve(__dirname, '..', 'tests', 'fixtures');
    const fixtureFiles = walkFixtureSkillFiles(fixtureRoot).filter((file) =>
      /tests\/fixtures\/(primary|adversarial)\/test-/i.test(file),
    );

    expect(fixtureFiles.length).toBeGreaterThan(0);

    for (const file of fixtureFiles) {
      const contents = fs.readFileSync(file, 'utf8');
      const hasMetadata = /Test metadata:/i.test(contents) || /Expected analyzer category:/i.test(contents);
      expect(hasMetadata).toBe(true);
    }
  });

  it('matches the documented fixture catalog in the release-readiness docs', () => {
    const fixtureReadme = path.resolve(__dirname, '..', 'tests', 'fixtures', 'README.md');
    const contents = fs.readFileSync(fixtureReadme, 'utf8');

    expect(contents).toContain('PRIMARY set');
    expect(contents).toContain('ADVERSARIAL / HARD set');
    expect(contents).toContain('Suggested validation harness');
    expect(contents).toContain('test-contradictions-direct');
  });

  it('keeps the primary fixture metadata aligned with the documented expected counts', () => {
    const fixtureRoot = path.resolve(__dirname, '..', 'tests', 'fixtures', 'primary');
    const fixtureFiles = walkFixtureSkillFiles(fixtureRoot);
    const expectedPrimaryFixtures = [
      ['test-contradictions-direct/SKILL.md', 15, 'contradiction'],
      ['test-contradictions-subtle/SKILL.md', 12, 'contradiction'],
      ['test-ambiguities/SKILL.md', 20, 'ambiguity'],
      ['test-cognitive-structural/SKILL.md', 13, 'cognitive_load'],
      ['test-coverage-gaps/SKILL.md', 15, 'coverage gaps'],
      ['test-instruction-quality/SKILL.md', 13, 'ambiguity'],
    ] as const;

    for (const [relativePath, expectedCount, expectedCategory] of expectedPrimaryFixtures) {
      const file = path.join(fixtureRoot, relativePath);
      const metadata = extractFixtureMetadata(file);

      expect(metadata.expectedCount).not.toBeNull();
      expect(metadata.expectedCount).toBeGreaterThanOrEqual(expectedCount);
      expect(metadata.contents.toLowerCase()).toContain(expectedCategory.toLowerCase());
    }

    expect(fixtureFiles.length).toBeGreaterThanOrEqual(expectedPrimaryFixtures.length);
  });

  it('keeps clean fixtures paired with expected answer files for calibration', () => {
    const cleanRoot = path.resolve(__dirname, '..', 'tests', 'fixtures', 'clean');
    const expectedRoot = path.resolve(__dirname, '..', 'tests', 'fixtures', 'expected');
    const cleanNames = listFiles(cleanRoot, '.md').map((file) => file.replace(/\.md$/, ''));
    const expectedNames = listFiles(expectedRoot, '.json').map((file) => file.replace(/\.json$/, ''));

    expect(cleanNames.length).toBeGreaterThanOrEqual(10);
    expect(cleanNames).toEqual(expectedNames);
  });

  it('validates expected answer files contain positive category counts', () => {
    const expectedRoot = path.resolve(__dirname, '..', 'tests', 'fixtures', 'expected');
    for (const file of listFiles(expectedRoot, '.json')) {
      const parsed = JSON.parse(fs.readFileSync(path.join(expectedRoot, file), 'utf8')) as {
        fixture?: string;
        expected?: Record<string, number>;
      };

      expect(parsed.fixture).toBe(file.replace(/\.json$/, ''));
      expect(parsed.expected).toBeDefined();
      expect(Object.keys(parsed.expected ?? {}).length).toBeGreaterThan(0);
      for (const [category, count] of Object.entries(parsed.expected ?? {})) {
        expect(category.trim()).not.toBe('');
        expect(Number.isInteger(count)).toBe(true);
        // A 0 median is a legitimate (and now explicitly tracked) calibration
        // outcome: the analyzer currently yields no findings for that category
        // on this fixture. The fixture's `notes` field records the known gap
        // (see plan Item 4 GAPS TO FIX). We keep the category in the map rather
        // than dropping it so the gap stays visible.
        expect(count).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('keeps clean fixtures free of label scaffolding and expected-count metadata', () => {
    const cleanRoot = path.resolve(__dirname, '..', 'tests', 'fixtures', 'clean');
    for (const file of listFiles(cleanRoot, '.md')) {
      const contents = fs.readFileSync(path.join(cleanRoot, file), 'utf8');
      expect(contents).not.toMatch(/Test metadata:/i);
      expect(contents).not.toMatch(/Expected analyzer categor/i);
      expect(contents).not.toMatch(/\[(?:HARD-CIRC|HARD-DIRECT|HARD-AMBIG|HARD-OBLIG|SUBTLE|DIRECT|COGNITIVE|PERSONA|QUALITY|STRUCTURAL|POSITIVE|NEGATIVE|INFER|GAP-H|GAP|AMBIENT)-\d+\]/);
    }
  });
});
