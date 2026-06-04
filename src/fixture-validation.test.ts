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
});
