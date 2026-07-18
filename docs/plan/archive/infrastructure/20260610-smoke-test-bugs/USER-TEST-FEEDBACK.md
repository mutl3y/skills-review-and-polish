# Test Findings

Add your test findings below. Just describe what went wrong — I'll debug and fix them.

---

## Findings

- switching to an openrouter model did not update provider, i then synced to mcp and it saved
{
  "provider": "vscode-lm",
  "model": "qwen/qwen3-8b",
  "deepModel": "",
  "fixModel": "xiaomi/mimo-v2-flash",
  "analysisMode": "single",
  "logLevel": "info"
}
- analyse failed /workspace/skills-review-and-polish/tests/fixtures/primary/test-ambiguities/SKILL.md
    2026-06-10 09:41:52.401 [info] Extension activated — log level: info
    2026-06-10 09:42:24.626 [info] selectModel: validating qwen/qwen3-8b before saving
    2026-06-10 09:42:25.469 [info] selectModel: model = qwen/qwen3-8b (Qwen: Qwen3 8B) — validated ✓
    2026-06-10 09:53:05.205 [info] syncMcpConfig: wrote /workspace/skills-review-and-polish/tests/fixtures/primary/.skills-review.json
    2026-06-10 09:54:18.601 [info] selectModel: validating gpt-4o-mini before saving
    2026-06-10 09:54:19.305 [info] selectModel: model = gpt-4o-mini (GPT-4o mini) — validated ✓
    2026-06-10 09:54:33.117 [info] analyzeDocument: START /workspace/skills-review-and-polish/tests/fixtures/primary/test-ambiguities/SKILL.md (3328 chars)
    2026-06-10 09:54:33.138 [info] buildEngine: provider=vscode-lm standardModel=gpt-4o-mini deepModel=(none)
    2026-06-10 09:54:33.138 [info] buildEngine: using vscode-lm
    2026-06-10 09:54:33.145 [info] analyzeDocument: calling engine.analyze on 3328 chars
    2026-06-10 09:54:40.559 [info] analyzeDocument: got 0 results
    2026-06-10 09:54:40.559 [info] analyzeDocument: score=100 grade=A+ type=standard
    2026-06-10 09:54:40.559 [info] analyzeDocument: DONE — No issues found.

- cmd pallet change provider option was not available had to go to settings to change it

## Thoughts

- we need to fix playwright copilot login issues so you can test this stuff, you can now test the prompts and code via thge mcp, this ui interface needs proper testing,
- user needs to be able to dynamically change the logging level so they can see whats going on in the ui
- we have a scan folder option, can we do the same for an individulal file
- the chances of a real skill not having a single issue is very unlikely, 0 results == housten we may have a problem
- can we make it easier to include / exclude waves, current config is a static list, be better with checkboxes for enabale / disable, would make sense if this was a choosable option on the right click options as well as to the llm via the mcp so its easy to tailor the scan
- need the ext host test we are doing to remove the accepted findings file from the mocks at launch so we start at the same position
