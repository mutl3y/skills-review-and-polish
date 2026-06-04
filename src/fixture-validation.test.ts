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
});
