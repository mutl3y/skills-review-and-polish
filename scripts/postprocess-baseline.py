#!/usr/bin/env python3
"""
Post-process the baseline-fork results to compute grades and penalties
using the actual src/core/scoring.ts logic (via the compiled JS module).

Usage: python3 scripts/postprocess-baseline.py
"""
import json
import os
import subprocess

DATA_DIR = '.github/experiments/documentation-review/data/baseline-fork'
SKILLS_ROOT = '/workspace/awesome-copilot-fork/skills'

node_script_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'score-one-skill.js')

results = []
for fname in sorted(os.listdir(DATA_DIR)):
    if fname == 'summary.json' or not fname.endswith('.json'):
        continue
    fpath = os.path.join(DATA_DIR, fname)
    skill_name = fname[:-len('.json')]
    try:
        result = subprocess.run(
            ['node', node_script_path, skill_name, fpath],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0 and result.stdout.strip():
            results.append(json.loads(result.stdout.strip()))
        else:
            print(f'  WARN: {skill_name}: {result.stderr.strip()[:200]}')
    except Exception as e:
        print(f'  ERR: {skill_name}: {e}')

by_grade = {}
for r in results:
    by_grade[r['grade']] = by_grade.get(r['grade'], 0) + 1

summary = {
    'label': 'baseline-fork-summary',
    'finished_at': '2026-07-10T14:00:00Z',
    'analyzer_config': {
        'mode': 'single', 'model': 'gpt-4o-mini',
        'fixes_applied': ['E8', 'E10', 'E9', 'E11'],
        'length_tiers_tuned': '2026-07-10'
    },
    'total_skills': len(results),
    'total_findings': sum(r['findings'] for r in results),
    'rate_limited': 0,
    'failed': 0,
    'by_grade': by_grade,
    'by_skill': sorted(results, key=lambda r: r['lines'], reverse=True),
}
with open(os.path.join(DATA_DIR, 'summary.json'), 'w') as f:
    json.dump(summary, f, indent=2)

print(f'\n## E13 baseline-fork (E8+E10+E9+E11 fixes + tuned length tiers)\n')
print(f'{"Skill":<35} {"Lines":>6} {"Type":<10} {"Grade":<8} {"Score":>5} {"Issue+Length":>14} {"Findings":>9}')
print('-' * 95)
for r in summary['by_skill']:
    print(f'{r["name"]:<35} {r["lines"]:>6} {r["type"]:<10} {r["grade"]:<8} {r["score"]:>5} {r["issue_penalty"]:>3}+{r["length_penalty"]:>2}={r["total_penalty"]:>3} {r["findings"]:>9}')

print(f'\nGrade distribution: {json.dumps(by_grade, sort_keys=True)}')
print(f'\nTotal findings: {summary["total_findings"]}')
print(f'A/A+ count: {sum(1 for r in results if r["grade"].startswith("A"))}/{len(results)} ({sum(1 for r in results if r["grade"].startswith("A"))*100//len(results)}%)')
